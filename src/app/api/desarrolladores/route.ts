// ============================================================
// API Route: /api/desarrolladores (#872; en pantalla «Empresas» desde la #949)
// GET  - Lista de empresas (cualquier usuario con sesión). ?tipo= filtra por tipo de empresa.
// POST - Alta (ADMIN, DIRECTOR, GERENTE)
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import {
  desarrolladorCrearSchema,
  esTablaFaltante,
  puedeEditarDesarrolladores,
  whereTipoEmpresa,
} from "@/lib/developer-partners/shared";

const SELECT_DESARROLLADOR = { id: true, name: true, type: true, website: true, email: true, phone: true } as const;

export async function GET(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  // #949: «Tipo de empresa». Un valor desconocido se ignora (lista completa).
  const tipo = new URL(req.url).searchParams.get("tipo");

  try {
    const data = await prisma.developerPartner.findMany({
      where: { deletedAt: null, ...(whereTipoEmpresa(tipo) ?? {}) },
      select: SELECT_DESARROLLADOR,
      orderBy: { name: "asc" },
    });
    // #949: el selector de empresa de la ficha ofrece «Crear empresa» solo si el rol puede.
    return NextResponse.json({ data, puedeEditar: puedeEditarDesarrolladores(session.user.role) });
  } catch (err) {
    // Desplegado antes que la migración: la pantalla queda vacía en vez de romper.
    if (esTablaFaltante(err)) return NextResponse.json({ data: [] });
    console.error("[GET /api/desarrolladores]", err);
    return NextResponse.json({ error: "Error al listar empresas" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!puedeEditarDesarrolladores(session.user.role)) {
    return NextResponse.json({ error: "Tu rol puede consultar empresas, pero no darlas de alta" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = desarrolladorCrearSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  try {
    const { name, type, website, email, phone } = parsed.data;
    const data = await prisma.developerPartner.create({
      data: {
        name,
        type,
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
    return NextResponse.json({ error: "Error al guardar la empresa" }, { status: 500 });
  }
}
