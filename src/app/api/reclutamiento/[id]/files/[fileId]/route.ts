// ============================================================
// #926 — GET /api/reclutamiento/[id]/files/[fileId][?descargar=1]
// Abre (o descarga con su nombre original) un CV: valida acceso y redirige a una URL firmada
// de 10 min recién hecha. Así la tabla enlaza el CV sin firmar URLs de todos los candidatos
// al cargar, y un enlace copiado deja de servir fuera del CRM.
// ============================================================
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { exigirReclutamiento } from "@/server/reclutamiento-acceso";
import { firmarLectura } from "@/lib/storage/crm-attachments";
import { esTablaFaltante } from "@/lib/reclutamiento/shared";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, props: { params: Promise<{ id: string; fileId: string }> }) {
  const { id, fileId } = await props.params;
  const r = await exigirReclutamiento();
  if ("respuesta" in r) return r.respuesta;

  try {
    const archivo = await prisma.recruitCandidateFile.findFirst({
      where: { id: fileId, candidateId: id, deletedAt: null, candidate: { deletedAt: null } },
      select: { storagePath: true, fileName: true },
    });
    if (!archivo) return NextResponse.json({ error: "Archivo no encontrado" }, { status: 404 });
    const urls = await firmarLectura([{ path: archivo.storagePath, fileName: archivo.fileName }]);
    const url = urls[archivo.storagePath];
    if (!url) return NextResponse.json({ error: "No se pudo abrir el archivo. Intenta de nuevo." }, { status: 502 });
    const descargar = new URL(request.url).searchParams.get("descargar") === "1";
    return NextResponse.redirect(descargar ? url.descargar : url.ver, 302);
  } catch (err) {
    if (esTablaFaltante(err)) return NextResponse.json({ error: "Archivo no encontrado" }, { status: 404 });
    throw err;
  }
}
