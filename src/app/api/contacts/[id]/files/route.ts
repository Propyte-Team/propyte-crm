// ============================================================
// #917 — /api/contacts/[id]/files — CV de la ficha del contacto.
// GET    → lista (el más nuevo primero) con URLs firmadas de 10 min para ver y descargar.
// POST   → confirma una subida ya hecha al bucket ({ path, fileName, mimeType, sizeBytes }).
// DELETE → ?fileId=… borra (quien lo subió o Admin/Director).
// Toda ruta exige acceso al contacto con la misma regla de rol y marca que la ficha.
// ============================================================
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { getContactAccessInfo } from "@/server/contacts";
import { borrarArchivo, existeArchivo, firmarLectura } from "@/lib/storage/crm-attachments";
import { motivoRechazo, nombreLimpio, puedeBorrar, puedeSubir, rutaEsDelContacto } from "@/lib/contacts/archivos";

export const dynamic = "force-dynamic";

const SIN_MIGRACION = "Falta aplicar la migración de CV (contact_files). Avisa a sistemas.";

function esSinMigracion(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2021";
}

type Sesion = { user: { id: string; role: string; plaza: string; name?: string | null } };

async function conAcceso(id: string): Promise<{ session: Sesion } | { respuesta: NextResponse }> {
  const session = (await getServerSession()) as Sesion | null;
  if (!session?.user) return { respuesta: NextResponse.json({ error: "No autorizado" }, { status: 401 }) };
  const access = await getContactAccessInfo(id, session);
  if (!access.ok) {
    return {
      respuesta: NextResponse.json(
        { error: access.reason === "not_found" ? "Contacto no encontrado" : "No tienes acceso a este contacto" },
        { status: access.reason === "not_found" ? 404 : 403 }
      ),
    };
  }
  return { session };
}

export async function GET(_request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const r = await conAcceso(id);
  if ("respuesta" in r) return r.respuesta;
  const { user } = r.session;

  try {
    const filas = await prisma.contactFile.findMany({
      where: { contactId: id, kind: "CV", deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, fileName: true, mimeType: true, sizeBytes: true, storagePath: true, createdAt: true,
        uploadedById: true, uploadedBy: { select: { name: true } },
      },
    });
    const urls = await firmarLectura(filas.map((f) => ({ path: f.storagePath, fileName: f.fileName })));
    return NextResponse.json({
      data: filas.map((f) => ({
        id: f.id,
        fileName: f.fileName,
        mimeType: f.mimeType,
        sizeBytes: f.sizeBytes,
        createdAt: f.createdAt,
        uploadedByName: f.uploadedBy?.name ?? null,
        verUrl: urls[f.storagePath]?.ver ?? null,
        descargarUrl: urls[f.storagePath]?.descargar ?? null,
        puedeBorrar: puedeBorrar(user, f),
      })),
      puedeSubir: puedeSubir(user.role),
    });
  } catch (err) {
    if (esSinMigracion(err)) return NextResponse.json({ error: SIN_MIGRACION, sinMigracion: true }, { status: 503 });
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
  const r = await conAcceso(id);
  if ("respuesta" in r) return r.respuesta;
  const { user } = r.session;
  if (!puedeSubir(user.role)) {
    return NextResponse.json({ error: "Tu rol puede ver los CV, pero no subirlos" }, { status: 403 });
  }

  const parsed = confirmarSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos del archivo incompletos" }, { status: 400 });
  const { path, fileName, mimeType, sizeBytes } = parsed.data;

  const motivo = motivoRechazo({ fileName, mimeType, sizeBytes });
  if (motivo) return NextResponse.json({ error: motivo }, { status: 422 });
  // Solo rutas generadas para ESTE contacto, y que de verdad estén en el bucket.
  if (!rutaEsDelContacto(path, id)) return NextResponse.json({ error: "Ruta de archivo inválida" }, { status: 400 });
  if (!(await existeArchivo(path))) {
    return NextResponse.json({ error: "El archivo no terminó de subirse. Intenta de nuevo." }, { status: 409 });
  }

  try {
    const fila = await prisma.contactFile.create({
      data: { contactId: id, kind: "CV", fileName: nombreLimpio(fileName), mimeType, sizeBytes, storagePath: path, uploadedById: user.id },
      select: { id: true },
    });
    return NextResponse.json({ data: fila }, { status: 201 });
  } catch (err) {
    if (esSinMigracion(err)) return NextResponse.json({ error: SIN_MIGRACION, sinMigracion: true }, { status: 503 });
    // Confirmar dos veces la misma subida: la ruta es única, no se duplica.
    if (typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002") {
      return NextResponse.json({ error: "Ese archivo ya estaba registrado" }, { status: 409 });
    }
    throw err;
  }
}

export async function DELETE(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const r = await conAcceso(id);
  if ("respuesta" in r) return r.respuesta;
  const { user } = r.session;

  const fileId = new URL(request.url).searchParams.get("fileId");
  if (!fileId) return NextResponse.json({ error: "Falta fileId" }, { status: 400 });

  try {
    const archivo = await prisma.contactFile.findFirst({
      where: { id: fileId, contactId: id, deletedAt: null },
      select: { id: true, storagePath: true, uploadedById: true },
    });
    if (!archivo) return NextResponse.json({ error: "Archivo no encontrado" }, { status: 404 });
    if (!puedeBorrar(user, archivo)) {
      return NextResponse.json({ error: "Solo quien lo subió o un Admin/Director puede borrarlo" }, { status: 403 });
    }
    await prisma.contactFile.update({
      where: { id: archivo.id },
      data: { deletedAt: new Date(), deletedById: user.id },
    });
    await borrarArchivo(archivo.storagePath);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (esSinMigracion(err)) return NextResponse.json({ error: SIN_MIGRACION, sinMigracion: true }, { status: 503 });
    throw err;
  }
}
