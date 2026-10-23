// ============================================================
// #926 — POST /api/reclutamiento/[id]/files/upload-url
// URL firmada para que el navegador suba el CV DIRECTO al bucket privado crm-attachments (nunca
// por esta API: Hostinger trunca el multipart de más de 1–2 MB). Después el navegador confirma
// con POST /api/reclutamiento/[id]/files. Body: { fileName, mimeType, sizeBytes }.
// ============================================================
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/db";
import { exigirReclutamiento } from "@/server/reclutamiento-acceso";
import { crearUrlDeSubida } from "@/lib/storage/crm-attachments";
import { esTablaFaltante, motivoRechazo, rutaCvCandidato, SIN_MIGRACION } from "@/lib/reclutamiento/shared";

export const dynamic = "force-dynamic";

const schema = z.object({
  fileName: z.string().min(1).max(300),
  mimeType: z.string().max(150).default("application/octet-stream"),
  sizeBytes: z.number().int().nonnegative(),
});

export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const r = await exigirReclutamiento();
  if ("respuesta" in r) return r.respuesta;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos del archivo incompletos" }, { status: 400 });
  const motivo = motivoRechazo(parsed.data);
  if (motivo) return NextResponse.json({ error: motivo }, { status: 422 });

  try {
    const existe = await prisma.recruitCandidate.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!existe) return NextResponse.json({ error: "Candidato no encontrado" }, { status: 404 });
  } catch (err) {
    if (esTablaFaltante(err)) return NextResponse.json({ error: SIN_MIGRACION, sinMigracion: true }, { status: 503 });
    throw err;
  }

  const path = rutaCvCandidato(id, parsed.data.fileName);
  const subida = await crearUrlDeSubida(path);
  if (!subida) return NextResponse.json({ error: "No se pudo preparar la subida. Intenta de nuevo." }, { status: 502 });
  return NextResponse.json({ data: { path, signedUrl: subida.signedUrl, token: subida.token } });
}
