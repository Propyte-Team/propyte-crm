// POST /api/admin/automation/rules/probar — «Probar con un contacto» (975). SOLO LECTURA: arma el
// contexto real del contacto (loadEntityContext) y evalúa la regla en edición, guardada o no, con
// probarRegla. No ejecuta acciones, no encola nada y no escribe en la base. Solo Dirección/Admin
// (igual que el CRUD de reglas).
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { conditionsDslSchema, TRIGGER_TYPES } from "@/lib/validations/rebuild-f1";
import { loadEntityContext, isBusinessHoursNow } from "@/lib/workflows/engine";
import { probarRegla, eventoDeDisparador } from "@/lib/workflows/probar-regla";

const MANAGE_ROLES = ["ADMIN", "DIRECTOR"];

const mapa = z.record(z.string(), z.string()).optional();
const bodySchema = z.object({
  contactId: z.string().min(1),
  rule: z.object({
    triggerType: z.enum(TRIGGER_TYPES),
    triggerConfig: z.record(z.string(), z.unknown()).default({}),
    conditions: conditionsDslSchema,
    actions: z.array(z.record(z.string(), z.unknown())).default([]),
  }),
  // Nombres de plantillas/cadencias/usuarios para escribir las acciones sin ids.
  fuentes: z.object({ plantillas: mapa, cadencias: mapa, usuarios: mapa }).optional(),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user || !MANAGE_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Solo Dirección/Admin" }, { status: 403 });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos", details: parsed.error.flatten() }, { status: 400 });
  }
  const { contactId, rule, fuentes } = parsed.data;

  const base = await loadEntityContext("contact", contactId);
  const contact = base.contact as { id: string; firstName?: string; lastName?: string } | null | undefined;
  if (!contact) return NextResponse.json({ error: "No se encontró el contacto" }, { status: 404 });

  // Datos de negocio: el más reciente del contacto (las condiciones deal.* lo leen).
  const deal = await prisma.deal.findFirst({
    where: { contactId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  const entidad = deal ? await loadEntityContext("deal", deal.id) : {};
  const ctx = {
    ...base,
    ...(entidad.deal ? { deal: entidad.deal } : {}),
    event: { type: eventoDeDisparador(rule), payload: {} },
    context: { isBusinessHours: await isBusinessHoursNow() },
  };

  const resultado = probarRegla(rule, ctx, fuentes);
  return NextResponse.json({
    data: {
      contacto: { id: contact.id, nombre: `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim() },
      ...resultado,
    },
  });
}
