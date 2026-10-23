// ============================================================
// #926 — /api/reclutamiento/[id]/files — CV del candidato.
// GET    → lista (el más nuevo primero) con quién lo subió y si quien pregunta puede borrarlo.
// POST   → confirma una subida ya hecha al bucket ({ path, fileName, mimeType, sizeBytes }).
// DELETE → ?fileId=… borra (quien lo subió o Admin/Director).
// Para abrir o descargar: GET /api/reclutamiento/[id]/files/[fileId] (redirige a URL firmada).
// ============================================================
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/db";
import { exigirReclutamiento } from "@/server/reclutamiento-acceso";
import { registrarCvDeCandidato } from "@/server/reclutamiento";
import { borrarArchivo, existeArchivo } from "@/lib/storage/crm-attachments";
import { esTablaFaltante, motivoRechazo, rutaEsDelCandidato, SIN_MIGRACION } from "@/lib/reclutamiento/shared";
import { puedeEliminarEnReclutamiento } from "@/lib/reclutamiento/roles";

export const dynamic = "force-dynamic";

function puedeBorrarCv(user: { id: string; role: string }, archivo: { uploadedById: string | null }): boolean {
  return archivo.uploadedById === user.id || puedeEliminarEnReclutamiento(user.role);
}

async function candidatoVigente(id: string): Promise<boolean> {
  return !!(await prisma.recruitCandidate.findFirst({ where: { id, deletedAt: null }, select: { id: true } }));
}

export async function GET(_request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const r = await exigirReclutamiento();
  if ("respuesta" in r) return r.respuesta;
  const { user } = r.session;

  try {
    if (!(await candidatoVigente(id))) return NextResponse.json({ error: "Candidato no encontrado" }, { status: 404 });
    const filas = await prisma.recruitCandidateFile.findMany({
      where: { candidateId: id, kind: "CV", deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true, fileName: true, mimeType: true, sizeBytes: true, createdAt: true, source: true, uploadedById: true },
    });
    const ids = [...new Set(filas.map((f) => f.uploadedById).filter((v): v is string => !!v))];
    const nombres = ids.length
      ? new Map(
          (await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map(
            (u: { id: string; name: string | null }) => [u.id, u.name] as const
          )
        )
      : new Map<string, string | null>();
    return NextResponse.json({
      data: filas.map((f) => ({
        id: f.id,
        fileName: f.fileName,
        mimeType: f.mimeType,
        sizeBytes: f.sizeBytes,
        createdAt: f.createdAt,
        source: f.source,
        uploadedByName: f.uploadedById ? nombres.get(f.uploadedById) ?? null : null,
        puedeBorrar: puedeBorrarCv(user, f),
      })),
    });
  } catch (err) {
    if (esTablaFaltante(err)) return NextResponse.json({ error: SIN_MIGRACION, sinMigracion: true }, { status: 503 });
    throw err;
  }
}

const confirmarSchema = z.object({
  path: z.string().min(1).max(300),
  fileName: z.string().min(1).max(300),
  mimeType: z.string().max(150).default("application/octet-stream"),
  sizeBytes: z.number().int().nonnegative(),
});

export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const r = await exigirReclutamiento();
  if ("respuesta" in r) return r.respuesta;

  const parsed = confirmarSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos del archivo incompletos" }, { status: 400 });
  const { path, fileName, mimeType, sizeBytes } = parsed.data;

  const motivo = motivoRechazo({ fileName, mimeType, sizeBytes });
  if (motivo) return NextResponse.json({ error: motivo }, { status: 422 });
  // Solo rutas generadas para ESTE candidato, y que de verdad estén en el bucket.
  if (!rutaEsDelCandidato(path, id)) return NextResponse.json({ error: "Ruta de archivo inválida" }, { status: 400 });

  try {
    if (!(await candidatoVigente(id))) return NextResponse.json({ error: "Candidato no encontrado" }, { status: 404 });
    if (!(await existeArchivo(path))) {
      return NextResponse.json({ error: "El archivo no terminó de subirse. Intenta de nuevo." }, { status: 409 });
    }
    const res = await registrarCvDeCandidato({
      candidateId: id,
      storagePath: path,
      fileName,
      mimeType,
      sizeBytes,
      source: "MANUAL",
      uploadedById: r.session.user.id,
    });
    if (res.duplicado) return NextResponse.json({ error: "Ese archivo ya estaba registrado" }, { status: 409 });
    return NextResponse.json({ data: { id: res.id } }, { status: 201 });
  } catch (err) {
    if (esTablaFaltante(err)) return NextResponse.json({ error: SIN_MIGRACION, sinMigracion: true }, { status: 503 });
    throw err;
  }
}

export async function DELETE(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const r = await exigirReclutamiento();
  if ("respuesta" in r) return r.respuesta;
  const { user } = r.session;

  const fileId = new URL(request.url).searchParams.get("fileId");
  if (!fileId) return NextResponse.json({ error: "Falta fileId" }, { status: 400 });

  try {
    const archivo = await prisma.recruitCandidateFile.findFirst({
      where: { id: fileId, candidateId: id, deletedAt: null },
      select: { id: true, storagePath: true, uploadedById: true },
    });
    if (!archivo) return NextResponse.json({ error: "Archivo no encontrado" }, { status: 404 });
    if (!puedeBorrarCv(user, archivo)) {
      return NextResponse.json({ error: "Solo quien lo subió o un Admin/Director puede borrarlo" }, { status: 403 });
    }
    await prisma.recruitCandidateFile.update({
      where: { id: archivo.id },
      data: { deletedAt: new Date(), deletedById: user.id },
    });
    await borrarArchivo(archivo.storagePath);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (esTablaFaltante(err)) return NextResponse.json({ error: SIN_MIGRACION, sinMigracion: true }, { status: 503 });
    throw err;
  }
}
