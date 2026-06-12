// ============================================================
// API Route: /api/developments
// Gestión de desarrollos inmobiliarios
// GET  - Listar desarrollos con filtros
// POST - Crear desarrollo (solo admin/director)
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { Prisma } from "@prisma/client";

/**
 * GET /api/developments
 * Lista desarrollos con filtros opcionales.
 * Accesible para todos los usuarios autenticados.
 */
export async function GET(request: NextRequest) {
  try {
    // Verificar autenticación
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);

    // Parámetros de filtro
    const plaza = searchParams.get("plaza") || undefined;
    const status = searchParams.get("status") || undefined;
    const developmentType = searchParams.get("type") || undefined;
    const search = searchParams.get("search") || undefined;
    const isActive = searchParams.get("isActive");

    // Construir filtros
    const where: Prisma.DevelopmentWhereInput = {
      deletedAt: null,
    };

    if (plaza) {
      where.plaza = plaza as any;
    }
    if (status) {
      where.status = status as any;
    }
    if (developmentType) {
      where.developmentType = developmentType as any;
    }
    if (isActive !== null && isActive !== undefined) {
      where.isActive = isActive === "true";
    }
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { developerName: { contains: search, mode: "insensitive" } },
        { location: { contains: search, mode: "insensitive" } },
      ];
    }

    // Ejecutar consulta
    const developments = await prisma.development.findMany({
      where,
      include: {
        _count: { select: { units: true, deals: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ data: developments });
  } catch (error) {
    console.error("Error al listar desarrollos:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/developments
 * Crea un nuevo desarrollo inmobiliario.
 * Solo accesible para Director, Gerente y Developer Ext.
 */
export async function POST(request: NextRequest) {
  try {
    // Verificar autenticación
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    // Fase 1: el CRM NO posee inventario (speckit MAESTRO §2.1). El catálogo de
    // desarrollos/unidades es propiedad del Hub (Propyte Hub). Creación local deshabilitada.
    return NextResponse.json(
      { error: "El CRM no administra inventario. Los desarrollos viven en el Hub (Propyte Hub)." },
      { status: 403 }
    );
  } catch (error) {
    console.error("Error al crear desarrollo:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
