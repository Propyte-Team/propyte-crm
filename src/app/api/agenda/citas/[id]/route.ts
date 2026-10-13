// ============================================================
// API Route: /api/agenda/citas/[id]
// PATCH - Editar una reunión o llamada desde las tablas de la Agenda (HUB #859)
//
// Hermana de /api/agenda/citas (alta). El schema es .strict() y no incluye status: completar,
// reabrir o cancelar sigue siendo cosa de /api/activities/[id]. El permiso (dueño o rol con
// acceso) y que el tipo solo cambie dentro de su familia los resuelve updateActivity.
// ============================================================

import { NextResponse } from "next/server";
import { z } from "zod";
import { updateActivity } from "@/server/activities";
import { dueDateSchema } from "@/lib/due-date";

const editarCitaSchema = z
  .object({
    activityType: z.enum([
      "MEETING_VIRTUAL",
      "MEETING_PRESENTIAL",
      "MEETING_SHOWROOM",
      "CALL_OUTBOUND",
      "CALL_INBOUND",
    ]),
    subject: z.string().trim().min(3, "El asunto debe tener al menos 3 caracteres").max(200),
    // null = el asesor vació el campo (borrar); omitido = no tocar.
    description: z.string().trim().max(5000).nullable().optional(),
    dueDate: dueDateSchema,
    durationMinutes: z.number().int().min(1).max(480).nullable().optional(),
    contactId: z.string().uuid("ID de contacto inválido").optional(),
  })
  .strict();

function errToResponse(error: unknown) {
  const msg = error instanceof Error ? error.message : "";
  if (msg.includes("No autorizado")) return NextResponse.json({ error: msg }, { status: 401 });
  if (msg.includes("permiso")) return NextResponse.json({ error: msg }, { status: 403 });
  if (msg.includes("no encontrada") || msg.includes("Contacto no encontrado")) {
    return NextResponse.json({ error: msg }, { status: 404 });
  }
  if (msg.includes("Tipo de actividad no válido")) return NextResponse.json({ error: msg }, { status: 400 });
  console.error("Error en /api/agenda/citas/[id]:", error);
  return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
}

export async function PATCH(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const body = await request.json();
    const validation = editarCitaSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: "Datos inválidos", details: validation.error.flatten() },
        { status: 400 },
      );
    }

    const { durationMinutes, description, ...rest } = validation.data;
    const activity = await updateActivity(params.id, {
      ...rest,
      description: description === undefined ? undefined : description || null,
      duration_minutes: durationMinutes,
    });
    return NextResponse.json({ data: activity });
  } catch (error) {
    return errToResponse(error);
  }
}
