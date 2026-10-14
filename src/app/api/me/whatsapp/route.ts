// «Conectar mi WhatsApp» (2026-10-14, coexistencia PR 2): el número propio de cada usuario.
// Spec: docs/superpowers/specs/2026-10-14-whatsapp-coexistencia-design.md §7.
//
// GET  → mi número conectado (si hay) con su estado, y mis «posibles prospectos» pendientes.
// POST → alta por Embedded Signup v4 (mismo orquestador que el de marca) con alcance ADVISOR y
//        dueño = la sesión. Cualquier rol puede conectar SU número; nadie el de otro.
//
// Los posibles prospectos solo los ve su dueño: aquí no hay parámetro de usuario, sale de la sesión.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { onboardCoexistenceNumber } from "@/lib/whatsapp/coex/onboard";
import { listPendingProspects } from "@/lib/whatsapp/coex/asesor";
import { coexStatusOf } from "@/lib/whatsapp/coex/status";

export const dynamic = "force-dynamic";
// Mismo peor caso que el alta de marca (ver /api/admin/connectors/whatsapp-coex).
export const maxDuration = 60;

const metaId = z.string().regex(/^\d{5,32}$/, "ID de Meta inválido");
const bodySchema = z.object({
  code: z.string().min(10).max(4096),
  wabaId: metaId,
  phoneNumberId: metaId.nullable().optional(),
});

export async function GET() {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const connectors = await prisma.leadConnector.findMany({
    where: { provider: "WHATSAPP", scope: "ADVISOR", ownerUserId: session.user.id, deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, status: true, lastError: true, config: true, createdAt: true },
  });
  const pending = await listPendingProspects(session.user.id);

  return NextResponse.json({
    data: {
      connectors: connectors.map(({ config, ...c }) => {
        const cfg = (config ?? {}) as { displayPhone?: string; verifiedName?: string };
        // Solo lo que la pantalla necesita: nada de config crudo.
        return { ...c, displayPhone: cfg.displayPhone ?? null, verifiedName: cfg.verifiedName ?? null, coex: coexStatusOf(config) };
      }),
      pending,
    },
  });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    // Sin el detalle de zod: repetiría el valor recibido, y uno de los campos es el código.
    const campos = [...new Set(parsed.error.issues.map((i) => i.path.join(".")))].join(", ");
    return NextResponse.json({ error: `Datos del alta inválidos (${campos || "cuerpo"}).` }, { status: 400 });
  }

  const owner = session.user.name?.trim() || session.user.email || "asesor";
  const result = await onboardCoexistenceNumber({
    code: parsed.data.code,
    wabaId: parsed.data.wabaId,
    phoneNumberId: parsed.data.phoneNumberId ?? null,
    scope: "ADVISOR",
    ownerUserId: session.user.id,
    name: `WhatsApp de ${owner}`.slice(0, 120),
    actorUserId: session.user.id,
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  const { created, connector, number, subscription, sync, warnings } = result;
  return NextResponse.json(
    { data: { created, connector, number, subscription, sync, warnings } },
    { status: created ? 201 : 200 },
  );
}
