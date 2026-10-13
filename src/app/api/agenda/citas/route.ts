// ============================================================
// API Route: /api/agenda/citas
// POST - Agendar una reunión o llamada PENDIENTE desde las tablas de la Agenda (HUB #857)
//
// Aparte de /api/agenda/activities (que solo acepta TASK y NOTE) para no aflojar su
// contrato. Aquí el contacto es obligatorio y la actividad nace PENDIENTE: createActivity
// marca COMPLETADA por defecto todo lo que no sea TASK, y una reunión o llamada completada
// no aparecería en las tablas de pendientes.
// ============================================================

import { NextResponse } from "next/server";
import { z } from "zod";
import { createActivity } from "@/server/activities";
import { dueDateSchema } from "@/lib/due-date";

const citaSchema = z
  .object({
    activityType: z.enum([
      "MEETING_VIRTUAL",
      "MEETING_PRESENTIAL",
      "MEETING_SHOWROOM",
      "CALL_OUTBOUND",
      "CALL_INBOUND",
    ]),
    subject: z.string().trim().min(3, "El asunto debe tener al menos 3 caracteres").max(200),
    description: z.string().trim().max(5000).optional(),
    // Obligatoria: una reunión o llamada sin fecha no tiene lugar en la agenda.
    dueDate: dueDateSchema,
    durationMinutes: z.number().int().min(1).max(480).optional(),
    contactId: z.string().uuid("ID de contacto inválido"),
  })
  .strict(); // dealId, userId, status y cualquier otro campo es un 400, no un silencio

function errToResponse(error: unknown) {
  const msg = error instanceof Error ? error.message : "";
  if (msg.includes("No autorizado")) return NextResponse.json({ error: msg }, { status: 401 });
  if (msg.includes("Contacto no encontrado")) return NextResponse.json({ error: msg }, { status: 404 });
  console.error("Error en /api/agenda/citas:", error);
  return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const validation = citaSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: "Datos inválidos", details: validation.error.flatten() },
        { status: 400 },
      );
    }

    const { durationMinutes, description, ...rest } = validation.data;

    // createActivity toma el userId de la sesión — nunca del body.
    const activity = await createActivity({
      ...rest,
      description: description || undefined,
      duration_minutes: durationMinutes,
      status: "PENDIENTE",
    });

    return NextResponse.json({ data: activity }, { status: 201 });
  } catch (error) {
    return errToResponse(error);
  }
}
