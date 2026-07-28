// Vistas guardadas (Fase 5, T5.4). GET por módulo (propias) · POST crear · DELETE.
// Resiliente: si la tabla aún no existe (migración pendiente), devuelve vacío sin romper.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";

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
  } catch {
    return NextResponse.json({ data: [] }); // tabla pendiente de migración
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
    await prisma.savedView.deleteMany({ where: { id, ownerId: session.user.id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true });
  }
}
