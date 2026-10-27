// ============================================================
// API Route: /api/agenda/activities
// POST - Captura rápida de la agenda personal (spec §6)
//
// contactId es OPCIONAL (HUB #841: Agenda conectada a Contactos). Sin él la
// actividad es personal; con él queda ligada al contacto y aparece en su ficha.
// createActivity verifica que el contacto exista y toma el userId de la sesión, salvo que venga
// `assigneeId` y el rol pueda asignar a esa persona (#915).
// Namespace propio para no alterar el comportamiento de /api/activities, que
// fuerza PENDIENTE por defecto.
// ============================================================

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createActivity,
  ERROR_ASIGNADO_NO_EXISTE,
  ERROR_SIN_PERMISO_ASIGNAR,
} from "@/server/activities";
import { dueDateSchema } from "@/lib/due-date";

const captureSchema = z
  .object({
    activityType: z.enum(["TASK", "NOTE"]),
    subject: z.string().trim().min(3, "El asunto debe tener al menos 3 caracteres").max(200),
    description: z.string().max(5000).optional(),
    dueDate: dueDateSchema.optional(),
    contactId: z.string().guid("ID de contacto inválido").optional(),
    // #915: dejarle la tarea a otra persona. NO es `userId`: el alcance lo decide el servidor
    // (resolverAsignadoTarea), no el body. Sin él la tarea es de quien la captura, como siempre.
    assigneeId: z.string().guid("ID de usuario inválido").optional(),
  })
  .strict(); // cualquier otro campo extra (dealId, userId) es un 400, no un silencio

function errToResponse(error: unknown) {
  const msg = error instanceof Error ? error.message : "";
  if (msg.includes("No autorizado")) return NextResponse.json({ error: msg }, { status: 401 });
  if (msg.includes("Contacto no encontrado")) return NextResponse.json({ error: msg }, { status: 404 });
  if (msg === ERROR_ASIGNADO_NO_EXISTE) return NextResponse.json({ error: msg }, { status: 400 });
  if (msg === ERROR_SIN_PERMISO_ASIGNAR) return NextResponse.json({ error: msg }, { status: 403 });
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

    // createActivity toma el userId de la sesión — nunca del body. `assigneeId` lo valida él.
    const activity = await createActivity(validation.data);

    return NextResponse.json({ data: activity }, { status: 201 });
  } catch (error) {
    return errToResponse(error);
  }
}
