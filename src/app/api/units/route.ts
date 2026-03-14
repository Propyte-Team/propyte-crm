// ============================================================
// API Route: /api/units
// Consulta de unidades por desarrollo
// GET - Listar unidades con filtro por desarrollo y estado
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { Prisma } from "@prisma/client";

/**
 * GET /api/units
 * Lista unidades de un desarrollo con filtro de estado.
 * Requiere parámetro developmentId.
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
    const developmentId = searchParams.get("developmentId");
    const status = searchParams.get("status") || undefined;
    const unitType = searchParams.get("unitType") || undefined;
    const minPrice = searchParams.get("minPrice");
    const maxPrice = searchParams.get("maxPrice");
    const sortBy = searchParams.get("sortBy") || "unitNumber";
    const sortOrder = (searchParams.get("sortOrder") || "asc") as "asc" | "desc";

    // El developmentId es requerido para listar unidades
    if (!developmentId) {
      return NextResponse.json(
        { error: "El parámetro developmentId es requerido" },
        { status: 400 }
      );
    }

    // Verificar que el desarrollo existe
    const development = await prisma.development.findUnique({
      where: { id: developmentId, deletedAt: null },
    });

    if (!development) {
      return NextResponse.json(
        { error: "Desarrollo no encontrado" },
        { status: 404 }
      );
    }

    // Construir filtros
    const where: Prisma.UnitWhereInput = {
      developmentId,
      deletedAt: null,
    };

    if (status) {
      where.status = status as any;
    }
    if (unitType) {
      where.unitType = unitType as any;
    }
    if (minPrice) {
      where.price = { ...((where.price as any) || {}), gte: parseFloat(minPrice) };
    }
    if (maxPrice) {
      where.price = { ...((where.price as any) || {}), lte: parseFloat(maxPrice) };
    }

    // Ejecutar consulta
    const units = await prisma.unit.findMany({
      where,
      include: {
        reservedByContact: {
          select: { id: true, firstName: true, lastName: true },
        },
        reservedByUser: {
          select: { id: true, name: true },
        },
        _count: { select: { deals: true } },
      },
      orderBy: { [sortBy]: sortOrder },
    });

    // Resumen de disponibilidad
    const summary = {
      total: units.length,
      disponible: units.filter((u) => u.status === "DISPONIBLE").length,
      apartada: units.filter((u) => u.status === "APARTADA").length,
      vendida: units.filter((u) => u.status === "VENDIDA").length,
      noDisponible: units.filter((u) => u.status === "NO_DISPONIBLE").length,
    };

    return NextResponse.json({
      data: units,
      summary,
      development: {
        id: development.id,
        name: development.name,
        plaza: development.plaza,
      },
    });
  } catch (error) {
    console.error("Error al listar unidades:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
