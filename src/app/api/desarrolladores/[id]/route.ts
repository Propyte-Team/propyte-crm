// ============================================================
// API Route: /api/desarrolladores/[id] (#872; «Empresas» desde la #949)
// PATCH - Corrige los datos de una empresa (ADMIN, DIRECTOR, GERENTE)
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { desarrolladorEditarSchema, esTablaFaltante, puedeEditarDesarrolladores } from "@/lib/developer-partners/shared";

const SELECT = { id: true, name: true, type: true, website: true, email: true, phone: true } as const;

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!puedeEditarDesarrolladores(session.user.role)) {
    return NextResponse.json({ error: "Tu rol puede consultar empresas, pero no editarlas" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = desarrolladorEditarSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  try {
    const existe = await prisma.developerPartner.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!existe) return NextResponse.json({ error: "Empresa no encontrada" }, { status: 404 });

    const data = await prisma.developerPartner.update({ where: { id }, data: parsed.data, select: SELECT });
    return NextResponse.json({ data });
  } catch (err) {
    if (esTablaFaltante(err)) return NextResponse.json({ error: "Empresa no encontrada" }, { status: 404 });
    console.error("[PATCH /api/desarrolladores/[id]]", err);
    return NextResponse.json({ error: "Error al guardar la empresa" }, { status: 500 });
  }
}
