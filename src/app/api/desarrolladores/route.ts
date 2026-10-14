// ============================================================
// API Route: /api/desarrolladores (#872)
// GET  - Lista de desarrolladores (cualquier usuario con sesión)
// POST - Alta (ADMIN, DIRECTOR)
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { desarrolladorCrearSchema, esTablaFaltante, puedeEditarDesarrolladores } from "@/lib/developer-partners/shared";

const SELECT_DESARROLLADOR = { id: true, name: true, website: true, email: true, phone: true } as const;

export async function GET() {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  try {
    const data = await prisma.developerPartner.findMany({
      where: { deletedAt: null },
      select: SELECT_DESARROLLADOR,
      orderBy: { name: "asc" },
    });
    return NextResponse.json({ data });
  } catch (err) {
    // Desplegado antes que la migración: la pantalla queda vacía en vez de romper.
    if (esTablaFaltante(err)) return NextResponse.json({ data: [] });
    console.error("[GET /api/desarrolladores]", err);
    return NextResponse.json({ error: "Error al listar desarrolladores" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!puedeEditarDesarrolladores(session.user.role)) {
    return NextResponse.json({ error: "Tu rol puede consultar desarrolladores, pero no darlos de alta" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = desarrolladorCrearSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  try {
    const { name, website, email, phone } = parsed.data;
    const data = await prisma.developerPartner.create({
      data: {
        name,
        website: website ?? null,
        email: email ?? null,
        phone: phone ?? null,
        createdById: session.user.id,
      },
      select: SELECT_DESARROLLADOR,
    });
    return NextResponse.json({ data }, { status: 201 });
  } catch (err) {
    if (esTablaFaltante(err)) {
      return NextResponse.json({ error: "El módulo aún no está listo en la base de datos" }, { status: 503 });
    }
    console.error("[POST /api/desarrolladores]", err);
    return NextResponse.json({ error: "Error al guardar el desarrollador" }, { status: 500 });
  }
}
