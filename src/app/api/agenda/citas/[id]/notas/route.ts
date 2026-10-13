// ============================================================
// API Route: /api/agenda/citas/[id]/notas (HUB #860)
// GET  - Notas escritas sobre esa reunión o llamada
// POST - Agregar una nota
// ============================================================

import { NextResponse } from "next/server";
import { z } from "zod";
import { addCitaNota, getCitaNotas } from "@/server/agenda-notas";

const notaSchema = z
  .object({
    texto: z.string().trim().min(1, "La nota no puede ir vacía").max(5000),
  })
  .strict();

function errToResponse(error: unknown) {
  const msg = error instanceof Error ? error.message : "";
  if (msg.includes("No autorizado")) return NextResponse.json({ error: msg }, { status: 401 });
  if (msg.includes("permiso")) return NextResponse.json({ error: msg }, { status: 403 });
  if (msg.includes("no encontrad")) return NextResponse.json({ error: msg }, { status: 404 });
  console.error("Error en /api/agenda/citas/[id]/notas:", error);
  return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
}

export async function GET(_request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const notas = await getCitaNotas(params.id);
    return NextResponse.json({ data: notas });
  } catch (error) {
    return errToResponse(error);
  }
}

export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const body = await request.json();
    const validation = notaSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: "Datos inválidos", details: validation.error.flatten() },
        { status: 400 },
      );
    }
    const nota = await addCitaNota(params.id, validation.data.texto);
    return NextResponse.json({ data: nota }, { status: 201 });
  } catch (error) {
    return errToResponse(error);
  }
}
