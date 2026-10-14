// POST /api/contacts/asignar-huerfanos (2026-10-14, #883): «Seleccionar todos → Asignar a…» del
// panel de leads huérfanos. La ruta solo valida la forma y traduce códigos a HTTP: quién puede, a
// quién y sobre qué contactos lo decide asignarHuerfanosEnLote (server/orphan-leads.ts), que a su
// vez asigna cada contacto por el mismo assignContact de la bandeja.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "@/lib/auth/session";
import { asignarHuerfanosEnLote, MAX_ASIGNACION_POR_LOTE } from "@/server/orphan-leads";

const bodySchema = z.object({
  contactIds: z.array(z.string().uuid()).min(1).max(MAX_ASIGNACION_POR_LOTE),
  assigneeId: z.string().uuid(),
});

const ERRORES = {
  "sin-permiso": { status: 403, error: "No tienes permiso para asignar desde Leads huérfanos" },
  "usuario-invalido": { status: 400, error: "La persona elegida no puede recibir prospectos" },
  demasiados: { status: 400, error: `Máximo ${MAX_ASIGNACION_POR_LOTE} contactos por asignación` },
  vacio: { status: 400, error: "No elegiste ningún contacto" },
} as const;

export async function POST(request: NextRequest) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const result = await asignarHuerfanosEnLote({
      actor: { id: session.user.id, role: session.user.role },
      contactIds: parsed.data.contactIds,
      assigneeId: parsed.data.assigneeId,
    });
    if (!result.ok) {
      const e = ERRORES[result.code];
      return NextResponse.json({ error: e.error }, { status: e.status });
    }
    return NextResponse.json({ data: result });
  } catch (error) {
    console.error("[leads-huerfanos] asignación masiva falló:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
