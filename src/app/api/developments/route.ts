// ============================================================
// API Route: /api/developments
// Gestión de desarrollos inmobiliarios
// GET  - Listar desarrollos con filtros
// POST - Crear desarrollo (solo admin/director)
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { Prisma } from "@prisma/client";

// Roles que pueden crear desarrollos
const ADMIN_ROLES = ["DIRECTOR", "GERENTE", "DEVELOPER_EXT"];

// Esquema de validación para crear desarrollo
const createDevelopmentSchema = z.object({
  name: z.string().min(3, "El nombre debe tener al menos 3 caracteres").max(200).trim(),
  developerName: z.string().min(2, "El nombre del desarrollador es requerido").max(200).trim(),
  developmentType: z.enum(["PROPIO", "MASTERBROKER", "CORRETAJE"]),
  location: z.string().min(5, "La ubicación es requerida").max(500).trim(),
  plaza: z.enum(["PDC", "TULUM", "MERIDA"]),
  totalUnits: z.number().int().positive("El total de unidades debe ser positivo"),
  availableUnits: z.number().int().min(0),
  priceMin: z.number().positive("El precio mínimo debe ser positivo"),
  priceMax: z.number().positive("El precio máximo debe ser positivo"),
  currency: z.enum(["MXN", "USD"]).optional(),
  totalDevelopmentValue: z.number().positive().optional(),
  commissionRate: z.number().min(0).max(100),
  status: z.enum(["PREVENTA", "CONSTRUCCION", "ENTREGA_INMEDIATA", "VENDIDO", "SUSPENDIDO"]).optional(),
  constructionProgress: z.number().int().min(0).max(100).optional(),
  deliveryDate: z.coerce.date().optional(),
  contractStartDate: z.coerce.date().optional(),
  contractEndDate: z.coerce.date().optional(),
  brochureUrl: z.string().url().optional().or(z.literal("")),
  virtualTourUrl: z.string().url().optional().or(z.literal("")),
  amenities: z.array(z.string().max(100)).optional(),
  description: z.string().min(10, "La descripción debe tener al menos 10 caracteres").max(5000).trim(),
});

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

    // Verificar que el usuario tiene permisos de admin
    if (!ADMIN_ROLES.includes(session.user.role)) {
      return NextResponse.json(
        { error: "Solo Director, Gerente o Developer pueden crear desarrollos" },
        { status: 403 }
      );
    }

    // Parsear y validar body
    const body = await request.json();
    const validation = createDevelopmentSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: "Datos inválidos", details: validation.error.flatten() },
        { status: 400 }
      );
    }

    const data = validation.data;

    // Validar que priceMax >= priceMin
    if (data.priceMax < data.priceMin) {
      return NextResponse.json(
        { error: "El precio máximo no puede ser menor al precio mínimo" },
        { status: 400 }
      );
    }

    // Crear el desarrollo
    const development = await prisma.development.create({
      data: {
        name: data.name,
        developerName: data.developerName,
        developmentType: data.developmentType,
        location: data.location,
        plaza: data.plaza,
        totalUnits: data.totalUnits,
        availableUnits: data.availableUnits,
        priceMin: data.priceMin,
        priceMax: data.priceMax,
        currency: data.currency || "MXN",
        totalDevelopmentValue: data.totalDevelopmentValue || null,
        commissionRate: data.commissionRate,
        status: data.status || "PREVENTA",
        constructionProgress: data.constructionProgress || 0,
        deliveryDate: data.deliveryDate || null,
        contractStartDate: data.contractStartDate || null,
        contractEndDate: data.contractEndDate || null,
        brochureUrl: data.brochureUrl || null,
        virtualTourUrl: data.virtualTourUrl || null,
        amenities: data.amenities || [],
        description: data.description,
      },
    });

    return NextResponse.json({ data: development }, { status: 201 });
  } catch (error) {
    console.error("Error al crear desarrollo:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
