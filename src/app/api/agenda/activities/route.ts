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

const CANCUN_TZ = "America/Cancun";
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Offset de Cancún en el instante dado, como "-05:00", derivado del
 * identificador IANA en vez de hardcodearlo. `America/Cancun` ya resuelve
 * DST vía Intl si México lo reinstaurara algún día — un offset fijo escrito
 * a mano no, y se desfasaría en silencio cerca de medianoche.
 */
function cancunOffset(at: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: CANCUN_TZ,
    timeZoneName: "longOffset",
  }).formatToParts(at);
  const name = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  return name.replace("GMT", "") || "+00:00";
}

/**
 * El <input type="date"> del cliente manda "YYYY-MM-DD" sin hora. Interpretarlo
 * como medianoche UTC lo correría a las 19:00 del día anterior en Cancún: una
 * tarea fechada el 30 se guardaría el 29 y aparecería vencida un día antes.
 * Se ancla a medianoche de Cancún. Un datetime completo pasa sin tocarse —
 * el anclaje es solo para el caso sin hora.
 *
 * El parser de fechas de JS además hace rollover silencioso en fechas de
 * calendario imposibles ("2026-02-30" → 2 de marzo). Para el caso sin hora,
 * reconstruimos año/mes/día en Cancún a partir de la fecha anclada y la
 * comparamos contra el string original: si no coinciden, hubo rollover.
 *
 * La regla vive SOLO aquí, en la frontera donde el string entra al sistema —
 * duplicarla en el módulo de agrupación la haría divergir.
 */
function parseDueDate(value: string): Date | null {
  if (DATE_ONLY.test(value)) {
    // Mediodía UTC como instante de sondeo para el offset: evita caer justo
    // en un borde de cambio de horario si algún día lo hubiera.
    const offset = cancunOffset(new Date(`${value}T12:00:00Z`));
    const anchored = new Date(`${value}T00:00:00${offset}`);
    if (Number.isNaN(anchored.getTime())) return null;

    const reconstructed = new Intl.DateTimeFormat("en-CA", {
      timeZone: CANCUN_TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(anchored);
    return reconstructed === value ? anchored : null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const dueDateSchema = z
  .string()
  .transform((value) => parseDueDate(value))
  .refine((d): d is Date => d !== null, { message: "Fecha inválida" });

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
