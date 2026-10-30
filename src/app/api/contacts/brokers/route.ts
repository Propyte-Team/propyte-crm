// ============================================================
// API Route: /api/contacts/brokers (#935)
// GET - Opciones del selector «Registrado por (broker)».
//
// ?search=  palabras del nombre (cada una en nombre o apellido)
// ?page=    1, 2, … de BROKERS_PAGE_SIZE en BROKERS_PAGE_SIZE (el selector carga más al bajar)
// ?excluir= id que no se ofrece (el propio contacto que se edita)
//
// Solo id y nombre: el catálogo es visible para todos los roles que trabajan contactos, pero la
// ficha del broker no (ver lib/contacts/catalogo-brokers.ts).
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import {
  BROKERS_PAGE_SIZE,
  brokerCatalogWhere,
  puedeVerCatalogoBrokers,
} from "@/lib/contacts/catalogo-brokers";
import { nombreDeContacto } from "@/lib/contacts/referidos";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    if (!puedeVerCatalogoBrokers(session.user.role)) {
      return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, Math.min(1000, parseInt(searchParams.get("page") || "1") || 1));
    const search = searchParams.get("search")?.slice(0, 100) || undefined;
    const excluirId = searchParams.get("excluir") || undefined;

    const where = await brokerCatalogWhere(session.user, { search, excluirId });
    const [filas, total] = await Promise.all([
      prisma.contact.findMany({
        where,
        select: { id: true, firstName: true, lastName: true },
        orderBy: [{ firstName: "asc" }, { lastName: "asc" }, { id: "asc" }],
        skip: (page - 1) * BROKERS_PAGE_SIZE,
        take: BROKERS_PAGE_SIZE,
      }),
      prisma.contact.count({ where }),
    ]);

    return NextResponse.json({
      data: filas.map((f) => ({ id: f.id, name: nombreDeContacto(f) })),
      total,
      page,
      hasMore: page * BROKERS_PAGE_SIZE < total,
    });
  } catch (error) {
    console.error("Error en /api/contacts/brokers:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
