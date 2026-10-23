// ============================================================
// #926 — /api/reclutamiento/[id]
// PATCH  → corrige datos o cambia la etapa (ADMIN, DIRECTOR, GERENTE).
// DELETE → borrado lógico del candidato y sus CV (ADMIN, DIRECTOR).
// ============================================================
import { NextRequest, NextResponse } from "next/server";
import { exigirReclutamiento } from "@/server/reclutamiento-acceso";
import { editarCandidato, eliminarCandidato } from "@/server/reclutamiento";
import { borrarArchivo } from "@/lib/storage/crm-attachments";
import { candidatoEditarSchema, esTablaFaltante } from "@/lib/reclutamiento/shared";
import { puedeEliminarEnReclutamiento } from "@/lib/reclutamiento/roles";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const r = await exigirReclutamiento();
  if ("respuesta" in r) return r.respuesta;

  const parsed = candidatoEditarSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  try {
    const data = await editarCandidato(id, parsed.data);
    if (!data) return NextResponse.json({ error: "Candidato no encontrado" }, { status: 404 });
    return NextResponse.json({ data });
  } catch (err) {
    if (esTablaFaltante(err)) return NextResponse.json({ error: "Candidato no encontrado" }, { status: 404 });
    console.error("[PATCH /api/reclutamiento/[id]]", err);
    return NextResponse.json({ error: "Error al guardar el candidato" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const r = await exigirReclutamiento();
  if ("respuesta" in r) return r.respuesta;
  if (!puedeEliminarEnReclutamiento(r.session.user.role)) {
    return NextResponse.json({ error: "Solo un Admin o Director puede eliminar candidatos" }, { status: 403 });
  }

  try {
    const res = await eliminarCandidato(id, r.session.user.id);
    if (!res) return NextResponse.json({ error: "Candidato no encontrado" }, { status: 404 });
    // Los CV salen del bucket (best-effort): el registro ya quedó marcado como borrado.
    await Promise.all(res.storagePaths.map((p) => borrarArchivo(p)));
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (esTablaFaltante(err)) return NextResponse.json({ error: "Candidato no encontrado" }, { status: 404 });
    console.error("[DELETE /api/reclutamiento/[id]]", err);
    return NextResponse.json({ error: "Error al eliminar el candidato" }, { status: 500 });
  }
}
