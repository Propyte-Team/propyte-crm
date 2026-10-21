// ============================================================
// API Route: /api/activities/asignables (#915)
// GET - A quién puede asignarle tareas el usuario actual, para el selector «Asignar a».
//
// Siempre empieza por uno mismo. Para ASESOR, BROKER, HOSTESS y cualquier rol que no asigna, la
// lista es solo él, y el selector no se muestra. La regla vive en src/lib/activities/asignacion.ts
// y el servidor la vuelve a comprobar al guardar: esta lista es comodidad, no la frontera.
// ============================================================

import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { asignablesWhere } from "@/lib/activities/asignacion";

/** Más que esto no cabe en un `<select>`. Hoy hay 10 asesores en todo el CRM. */
const TOPE = 200;

export async function GET() {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const yo = { id: session.user.id, name: session.user.name ?? "Yo", role: session.user.role };
    const where = asignablesWhere(session.user);
    const otros = where
      ? await prisma.user.findMany({
          where,
          select: { id: true, name: true, role: true },
          orderBy: { name: "asc" },
          take: TOPE,
        })
      : [];

    return NextResponse.json({ data: [yo, ...otros], puedeAsignar: otros.length > 0 });
  } catch (error) {
    console.error("Error en /api/activities/asignables:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
