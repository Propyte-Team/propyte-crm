// ============================================================
// API Route: /api/catalogos/campanas (#937)
// GET  - Campañas y eventos que se pueden elegir en «Detalle de la fuente» + si puede crear.
// POST - «Crear +»: { name, kind: "CAMPANA" | "EVENTO" } → nueva (201) o la existente (200).
// ============================================================

import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "@/lib/auth/session";
import { puedeCrearEnCatalogo } from "@/lib/catalogos/clave";
import { crearCampana, listarCampanas } from "@/lib/contacts/campanas";

export const dynamic = "force-dynamic";

const altaSchema = z.object({ name: z.string().max(300), kind: z.string().max(40) }).strict();

export async function GET() {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    return NextResponse.json({ data: await listarCampanas(), puedeCrear: puedeCrearEnCatalogo(session.user.role) });
  } catch (error) {
    console.error("Error en GET /api/catalogos/campanas:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!puedeCrearEnCatalogo(session.user.role)) {
    return NextResponse.json({ error: "No tienes permiso para crear campañas o eventos" }, { status: 403 });
  }
  const parsed = altaSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  try {
    const r = await crearCampana(parsed.data.name, parsed.data.kind, session.user.id);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    return NextResponse.json({ data: r.data, creada: r.creada }, { status: r.creada ? 201 : 200 });
  } catch (error) {
    console.error("Error en POST /api/catalogos/campanas:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
