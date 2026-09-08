// ============================================================
// API Route: /api/units
// Consulta de unidades por desarrollo
// GET - Listar unidades con filtro por desarrollo y estado
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { Prisma } from "@prisma/client";
import { ordenValidado } from "@/lib/api/orden";
import {
  valorDeEnum,
  numeroNoNegativo,
  ESTADOS_DE_UNIDAD,
  TIPOS_DE_UNIDAD,
} from "@/lib/api/filtros";

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

    // #745: todo lo que venía crudo del query string se valida aquí, antes de tocar la
    // base. Un parámetro mal escrito es un 400, no el 500 que devolvía Prisma.
    const orden = ordenValidado(
      "unit",
      searchParams.get("sortBy"),
      searchParams.get("sortOrder")
    );
    const estado = valorDeEnum("status", ESTADOS_DE_UNIDAD, status);
    const tipo = valorDeEnum("unitType", TIPOS_DE_UNIDAD, unitType);
    const precioMin = numeroNoNegativo("minPrice", minPrice);
    const precioMax = numeroNoNegativo("maxPrice", maxPrice);

    const invalido =
      orden.error ?? estado.error ?? tipo.error ?? precioMin.error ?? precioMax.error;
    if (invalido) {
      return NextResponse.json({ error: invalido }, { status: 400 });
    }

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

    if (estado.valor) where.status = estado.valor;
    if (tipo.valor) where.unitType = tipo.valor;
    if (precioMin.valor !== undefined) {
      where.price = { ...((where.price as any) || {}), gte: precioMin.valor };
    }
    if (precioMax.valor !== undefined) {
      where.price = { ...((where.price as any) || {}), lte: precioMax.valor };
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
      orderBy: orden.orderBy,
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
