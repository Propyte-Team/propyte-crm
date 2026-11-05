// GET /api/admin/journey/embudo?dias=30&plaza=&flujo=&asesor=
// Embudo del Journey (J1 #985): contactos por estado hoy, entradas y avances en la ventana,
// mediana de días en el estado y atorados. La lógica vive en lib/journey/embudo.ts; aquí solo se
// traen los datos con consultas agregadas (sin N+1) y en lotes (enLotes, #974).
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { enLotes } from "@/lib/db/lotes";
import { whereFlujo } from "@/lib/flujos";
import {
  PASOS_EMBUDO, FUENTES_MASIVAS, ROLES_EMBUDO, calcularEmbudo, pasoDeRegla,
  type CambioDeEstado, type Estancia,
} from "@/lib/journey/embudo";

const DIAS_VALIDOS = [7, 30, 90];
const PLAZAS = ["PDC", "TULUM", "MERIDA"];
const DIA_MS = 86_400_000;

// Cambios hechos por cargas masivas: se descartan en SQL (la lista de embudo.ts y «llenado»/«migraci»).
const ORGANICO = Prisma.sql`(f.source is null or (
  lower(f.source) not like '%llenado%' and lower(f.source) not like '%migraci%'
  and f.source <> all(${FUENTES_MASIVAS as string[]})
))`;

export async function GET(req: Request) {
  const session = await getServerSession();
  if (!session?.user || !ROLES_EMBUDO.includes(session.user.role)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const sp = new URL(req.url).searchParams;
  const diasPedidos = Number(sp.get("dias"));
  const dias = DIAS_VALIDOS.includes(diasPedidos) ? diasPedidos : 30;

  // Contactos no tienen plaza propia: se filtra por la plaza del asesor. Un gerente solo ve la suya.
  const esGerente = session.user.role === "GERENTE";
  const plazaPedida = sp.get("plaza") || null;
  const plazaFija = esGerente ? session.user.plaza ?? null : null;
  const plaza = plazaFija ?? (plazaPedida && PLAZAS.includes(plazaPedida) ? plazaPedida : null);
  const porFlujo = whereFlujo(sp.get("flujo"));
  const asesor = (sp.get("asesor") || "").slice(0, 64) || null;

  const where: Prisma.ContactWhereInput = { deletedAt: null };
  if (porFlujo) where.flujo = porFlujo.flujo;
  if (asesor) where.assignedToId = asesor;
  if (plaza) where.assignedTo = { plaza: plaza as never };

  // Mismos filtros para las consultas SQL (alias c = contacts, u = users).
  const filtrosSql = Prisma.sql`
    ${porFlujo ? (porFlujo.flujo === null ? Prisma.sql`and c.flujo is null` : Prisma.sql`and c.flujo::text = ${porFlujo.flujo}`) : Prisma.empty}
    ${asesor ? Prisma.sql`and c."assignedToId" = ${asesor}` : Prisma.empty}
    ${plaza ? Prisma.sql`and u.plaza::text = ${plaza}` : Prisma.empty}`;

  const ahora = new Date();
  const corte = new Date(ahora.getTime() - dias * DIA_MS);

  try {
    const [grupos, cambiosRaw, estanciasRaw, reglas] = await enLotes([
      () => prisma.contact.groupBy({ by: ["estado"], where, _count: { _all: true } }),
      // Cambios de estado de la ventana. `desdeEn` = cuándo entró el contacto al estado del que sale
      // (el cambio orgánico anterior; si no hay, su alta). Todo en una consulta con lag().
      () => prisma.$queryRaw<{ contactId: string; desde: string | null; hasta: string | null; en: Date; source: string | null; desdeEn: Date | null }[]>`
        with org as (
          select f.entity_id, f.old_value #>> '{}' as desde, f.new_value #>> '{}' as hasta, f.source, f.changed_at,
            lag(f.changed_at) over (partition by f.entity_id order by f.changed_at) as ant_en,
            lag(f.new_value #>> '{}') over (partition by f.entity_id order by f.changed_at) as ant_hasta
          from propyte_crm.record_field_changes f
          where f.entity_type = 'contact' and f.field = 'estado' and ${ORGANICO}
        )
        select o.entity_id as "contactId", o.desde, o.hasta, o.source, o.changed_at as "en",
          case when o.ant_hasta is not distinct from o.desde then o.ant_en else c."createdAt" end as "desdeEn"
        from org o
        join propyte_crm.contacts c on c.id = o.entity_id
        left join propyte_crm.users u on u.id = c."assignedToId"
        where o.changed_at >= ${corte}::timestamptz and c."deletedAt" is null
        ${filtrosSql}`,
      // Desde cuándo está cada contacto en su estado actual (último cambio orgánico hacia él, o su
      // alta): una sola consulta con subconsulta correlacionada sobre el índice por contacto.
      () => prisma.$queryRaw<{ contactId: string; estado: string; desde: Date }[]>`
        select c.id as "contactId", c.estado::text as estado,
          coalesce((
            select max(f.changed_at) from propyte_crm.record_field_changes f
            where f.entity_type = 'contact' and f.field = 'estado' and f.entity_id = c.id
              and f.new_value #>> '{}' = c.estado::text and ${ORGANICO}
          ), c."createdAt") as desde
        from propyte_crm.contacts c
        left join propyte_crm.users u on u.id = c."assignedToId"
        where c."deletedAt" is null and c.estado::text = any(${PASOS_EMBUDO as unknown as string[]})
        ${filtrosSql}`,
      () => prisma.automationRule.findMany({
        where: { deletedAt: null },
        select: { id: true, name: true, isActive: true, triggerType: true, triggerConfig: true },
        orderBy: [{ priority: "asc" }, { name: "asc" }],
      }),
    ]);

    const conteosHoy: Record<string, number> = {};
    for (const g of grupos) conteosHoy[g.estado ?? ""] = g._count._all;

    const cambios: CambioDeEstado[] = cambiosRaw.map((c) => ({ ...c, en: new Date(c.en), desdeEn: c.desdeEn ? new Date(c.desdeEn) : null }));
    const estancias: Estancia[] = estanciasRaw.map((s) => ({ ...s, desde: new Date(s.desde) }));

    const embudo = calcularEmbudo({ conteosHoy, cambios, estancias, ahora, dias });

    return NextResponse.json({
      dias,
      desde: corte.toISOString(),
      plazaFija,
      ...embudo,
      reglas: reglas.map((r) => ({
        id: r.id,
        name: r.name,
        isActive: r.isActive,
        paso: pasoDeRegla({ triggerType: r.triggerType, triggerConfig: (r.triggerConfig ?? {}) as Record<string, unknown> }),
      })),
    });
  } catch (error) {
    console.error("Error al calcular el embudo:", error);
    return NextResponse.json({ error: "No se pudo calcular el embudo" }, { status: 500 });
  }
}
