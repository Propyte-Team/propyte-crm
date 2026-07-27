// ============================================================
// API Route: /api/agenda/activities
// POST - Captura rápida de la agenda personal (spec §6)
//
// No acepta contactId: una actividad capturada aquí es personal por
// construcción. Namespace propio para no alterar el comportamiento de
// /api/activities, que fuerza PENDIENTE por defecto.
// ============================================================

import { NextResponse } from "next/server";
import { z } from "zod";
import { createActivity } from "@/server/activities";
import { dueDateSchema } from "@/lib/due-date";

const captureSchema = z
  .object({
    activityType: z.enum(["TASK", "NOTE"]),
    subject: z.string().trim().min(3, "El asunto debe tener al menos 3 caracteres").max(200),
    description: z.string().max(5000).optional(),
    dueDate: dueDateSchema.optional(),
  })
  .strict(); // cualquier campo extra (contactId, dealId, userId) es un 400, no un silencio

function errToResponse(error: unknown) {
  const msg = error instanceof Error ? error.message : "";
  if (msg.includes("No autorizado")) return NextResponse.json({ error: msg }, { status: 401 });
  console.error("Error en /api/agenda/activities:", error);
  return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const validation = captureSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: "Datos inválidos", details: validation.error.flatten() },
        { status: 400 },
      );
    }

    // createActivity toma el userId de la sesión — nunca del body.
    const activity = await createActivity(validation.data);

    return NextResponse.json({ data: activity }, { status: 201 });
  } catch (error) {
    return errToResponse(error);
  }
}
