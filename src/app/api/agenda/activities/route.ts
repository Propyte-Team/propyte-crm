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

// Cancún es UTC−5 sin horario de verano.
const CANCUN_OFFSET = "-05:00";
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * El <input type="date"> del cliente manda "YYYY-MM-DD" sin hora. `z.coerce.date()`
 * lo interpretaría como medianoche UTC, que en Cancún son las 19:00 del día anterior:
 * una tarea fechada el 30 se guardaría el 29 y aparecería vencida un día antes.
 * Se ancla a medianoche de Cancún. Un datetime completo pasa sin tocarse.
 *
 * La regla vive SOLO aquí, en la frontera donde el string entra al sistema —
 * duplicarla en el módulo de agrupación la haría divergir.
 */
const dueDateSchema = z
  .union([z.string(), z.date()])
  .transform((v) =>
    typeof v === "string" && DATE_ONLY.test(v)
      ? new Date(`${v}T00:00:00${CANCUN_OFFSET}`)
      : new Date(v),
  )
  .refine((d) => !Number.isNaN(d.getTime()), { message: "Fecha inválida" });

const captureSchema = z
  .object({
    activityType: z.enum(["TASK", "NOTE"]),
    subject: z.string().min(3, "El asunto debe tener al menos 3 caracteres").max(200).trim(),
    description: z.string().max(5000).optional(),
    dueDate: dueDateSchema.optional(),
  })
  .strict(); // cualquier campo extra (contactId, dealId, userId) es un 400, no un silencio

function errToResponse(error: unknown) {
  const msg = error instanceof Error ? error.message : "";
  if (msg.includes("No autorizado")) return NextResponse.json({ error: msg }, { status: 401 });
  if (msg.includes("permiso")) return NextResponse.json({ error: msg }, { status: 403 });
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
