// ============================================================
// #926 — /api/reclutamiento
// GET  → candidatos vigentes, el más reciente primero.
// POST → alta. Solo ADMIN, DIRECTOR y GERENTE (src/lib/reclutamiento/roles.ts).
// ============================================================
import { NextRequest, NextResponse } from "next/server";
import { exigirReclutamiento } from "@/server/reclutamiento-acceso";
import { crearCandidato, listarCandidatos } from "@/server/reclutamiento";
import { candidatoCrearSchema, esTablaFaltante, SIN_MIGRACION } from "@/lib/reclutamiento/shared";

export const dynamic = "force-dynamic";

export async function GET() {
  const r = await exigirReclutamiento();
  if ("respuesta" in r) return r.respuesta;
  try {
    return NextResponse.json({ data: await listarCandidatos() });
  } catch (err) {
    if (esTablaFaltante(err)) return NextResponse.json({ data: [], sinMigracion: true });
    console.error("[GET /api/reclutamiento]", err);
    return NextResponse.json({ error: "Error al listar candidatos" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const r = await exigirReclutamiento();
  if ("respuesta" in r) return r.respuesta;

  const parsed = candidatoCrearSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  try {
    const data = await crearCandidato(parsed.data, r.session.user.id);
    return NextResponse.json({ data }, { status: 201 });
  } catch (err) {
    if (esTablaFaltante(err)) return NextResponse.json({ error: SIN_MIGRACION, sinMigracion: true }, { status: 503 });
    console.error("[POST /api/reclutamiento]", err);
    return NextResponse.json({ error: "Error al guardar el candidato" }, { status: 500 });
  }
}
