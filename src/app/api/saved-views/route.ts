// Vistas guardadas (Fase 5, T5.4). GET por módulo (propias) · POST crear · DELETE.
// Resiliente: si la tabla aún no existe (migración pendiente), devuelve vacío sin romper.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";

/** P2021 = la tabla no existe. Es lo ÚNICO que los `catch` de este archivo perdonan. */
function esTablaSinMigrar(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2021";
}

const createSchema = z.object({
  name: z.string().min(1).max(80).trim(),
  module: z.string().min(2).max(40),
  filters: z.record(z.unknown()).default({}),
  scope: z.enum(["personal", "team", "org"]).default("personal"),
});

export async function GET(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  // No se llama `module`: sombrear ese identificador rompe el bundler de Next
  // (regla @next/next/no-assign-module-variable). La columna sigue siendo `module`.
  const moduleParam = req.nextUrl.searchParams.get("module") ?? undefined;
  try {
    const views = await prisma.savedView.findMany({
      where: {
        ...(moduleParam ? { module: moduleParam } : {}),
        OR: [{ ownerId: session.user.id }, { scope: { in: ["team", "org"] } }],
      },
      orderBy: { createdAt: "asc" },
    });
    return NextResponse.json({ data: views });
  } catch (err) {
    // Auditoría 2026-09-10: este `catch` devolvía lista vacía ante CUALQUIER error. El
    // usuario veía «no tienes vistas guardadas» cuando en realidad la consulta falló, y
    // eso invita a rehacer a mano un trabajo que sigue estando ahí. Sólo se perdona
    // P2021 (la tabla aún no existe), que es lo que el `try` venía a cubrir.
    if (esTablaSinMigrar(err)) return NextResponse.json({ data: [] });
    console.error("[saved-views] GET:", err);
    return NextResponse.json({ error: "No se pudieron cargar las vistas" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  try {
    const view = await prisma.savedView.create({
      data: { ...parsed.data, ownerId: session.user.id, filters: parsed.data.filters as never },
    });
    return NextResponse.json({ data: view }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "No se pudo guardar la vista (¿migración pendiente?)" }, { status: 503 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id requerido" }, { status: 400 });
  try {
    const r = await prisma.savedView.deleteMany({ where: { id, ownerId: session.user.id } });
    // Antes devolvía `ok: true` pasara lo que pasara: un id inexistente, la vista de otro
    // usuario y un fallo de la base daban la misma respuesta que un borrado real. La
    // interfaz quitaba la fila y al recargar volvía a aparecer.
    if (r.count === 0) {
      return NextResponse.json({ error: "Vista no encontrada" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (esTablaSinMigrar(err)) return NextResponse.json({ ok: true });
    console.error("[saved-views] DELETE:", err);
    return NextResponse.json({ error: "No se pudo borrar la vista" }, { status: 500 });
  }
}
