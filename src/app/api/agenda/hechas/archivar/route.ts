// ============================================================
// API Route: /api/agenda/hechas/archivar
// POST - "Eliminar todo" del panel Tareas hechas de la Agenda (HUB #841)
//
// ARCHIVA las tareas completadas del propio usuario (archivedAt/archivedById):
// el asesor deja de verlas, pero siguen en base con quién las completó y cuándo
// para los reportes que descarga el Admin. No hay borrado definitivo.
// ============================================================

import { NextResponse } from "next/server";
import { archiveMyDoneTasks } from "@/server/agenda";

export async function POST() {
  try {
    const result = await archiveMyDoneTasks();
    return NextResponse.json({ data: result });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "";
    if (msg.includes("No autorizado")) return NextResponse.json({ error: msg }, { status: 401 });
    console.error("Error en /api/agenda/hechas/archivar:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
