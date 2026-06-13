// ============================================================
// API Route: /api/activities/[id]
// PATCH  - Actualizar (completar tarea, editar, cancelar)
// DELETE - Soft-delete
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { updateActivity, deleteActivity } from "@/server/activities";

const updateActivitySchema = z.object({
  subject: z.string().min(3).max(200).trim().optional(),
  description: z.string().max(5000).nullable().optional(),
  dueDate: z.coerce.date().nullable().optional(),
  status: z.enum(["PENDIENTE", "COMPLETADA", "VENCIDA", "CANCELADA"]).optional(),
  outcome: z.string().max(1000).nullable().optional(),
  duration_minutes: z.number().int().min(0).max(480).nullable().optional(),
});

function errToResponse(error: unknown) {
  const msg = error instanceof Error ? error.message : "";
  if (msg.includes("No autorizado")) return NextResponse.json({ error: msg }, { status: 401 });
  if (msg.includes("permiso")) return NextResponse.json({ error: msg }, { status: 403 });
  if (msg.includes("no encontrada")) return NextResponse.json({ error: msg }, { status: 404 });
  console.error("Error en /api/activities/[id]:", error);
  return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const validation = updateActivitySchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: "Datos inválidos", details: validation.error.flatten() },
        { status: 400 }
      );
    }
    const { description, outcome, dueDate, duration_minutes, ...rest } = validation.data;
    const activity = await updateActivity(params.id, {
      ...rest,
      description: description ?? undefined,
      outcome: outcome ?? undefined,
      dueDate: dueDate,
      duration_minutes: duration_minutes ?? undefined,
    });
    return NextResponse.json({ data: activity });
  } catch (error) {
    return errToResponse(error);
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const result = await deleteActivity(params.id);
    return NextResponse.json({ data: result });
  } catch (error) {
    return errToResponse(error);
  }
}
