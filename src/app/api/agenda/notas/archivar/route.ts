// ============================================================
// API Route: /api/agenda/notas/archivar (#924)
// POST - "Eliminar" de Notas recientes de la Agenda: una, las seleccionadas o todas.
//
// Body: { ids: string[] } o { todas: true }. Se pide explícito a propósito: un body vacío
// no puede terminar archivando todo.
//
// ARCHIVA (archivedAt/archivedById), igual que "Eliminar todo" de Tareas hechas (#841): la nota
// sale de la Agenda pero sigue en la ficha del contacto. Solo toca notas del propio usuario.
// ============================================================

import { NextResponse } from "next/server";
import { z } from "zod";
import { archiveMyNotes, NOTES_ARCHIVE_MAX_IDS } from "@/server/agenda";

const bodySchema = z.union([
  z.object({ todas: z.literal(true) }).strict(),
  z
    .object({
      ids: z
        .array(z.string().min(1).max(64))
        .min(1, "Elige al menos una nota")
        .max(NOTES_ARCHIVE_MAX_IDS, `Máximo ${NOTES_ARCHIVE_MAX_IDS} notas por vez`),
    })
    .strict(),
]);

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const validation = bodySchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: "Datos inválidos", details: validation.error.flatten() },
        { status: 400 },
      );
    }
    const result = await archiveMyNotes(validation.data);
    return NextResponse.json({ data: result });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "";
    if (msg.includes("No autorizado")) return NextResponse.json({ error: msg }, { status: 401 });
    console.error("Error en /api/agenda/notas/archivar:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
