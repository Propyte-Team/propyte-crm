// ============================================================
// API Route: /api/catalogos/etiquetas (#936)
// GET  - Etiquetas que se pueden elegir en un contacto + si quien pide puede crear.
// POST - «Crear +»: { name } → la etiqueta nueva (201) o la que ya existía con ese nombre (200).
//
// Crean todos los roles que editan contactos (decisión de sistemas@, 30-oct). La clave sin
// acentos ni mayúsculas impide variantes: «lead frio» devuelve «LEAD FRIO».
// ============================================================

import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "@/lib/auth/session";
import { puedeCrearEnCatalogo } from "@/lib/catalogos/clave";
import { crearEtiqueta, listarEtiquetas } from "@/lib/contacts/etiquetas";

export const dynamic = "force-dynamic";

const altaSchema = z.object({ name: z.string().max(200) }).strict();

export async function GET() {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    return NextResponse.json({ data: await listarEtiquetas(), puedeCrear: puedeCrearEnCatalogo(session.user.role) });
  } catch (error) {
    console.error("Error en GET /api/catalogos/etiquetas:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!puedeCrearEnCatalogo(session.user.role)) {
    return NextResponse.json({ error: "No tienes permiso para crear etiquetas" }, { status: 403 });
  }
  const parsed = altaSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  try {
    const r = await crearEtiqueta(parsed.data.name, session.user.id);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    return NextResponse.json({ data: r.data, creada: r.creada }, { status: r.creada ? 201 : 200 });
  } catch (error) {
    console.error("Error en POST /api/catalogos/etiquetas:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
