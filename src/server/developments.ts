// ============================================================
// Server Actions: Gestión de desarrollos e inventario de unidades
// ============================================================

"use server";

import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import type { Prisma, Plaza, DevelopmentStatus, DevelopmentType, UnitStatus, UnitType } from "@prisma/client";

// Roles con permiso de administración de desarrollos
const ADMIN_ROLES = ["DIRECTOR", "GERENTE", "DEVELOPER_EXT"];

// --- Tipos de filtros ---
interface DevelopmentFilters {
  plaza?: Plaza;
  status?: DevelopmentStatus;
  developmentType?: DevelopmentType;
  search?: string;
  isActive?: boolean;
}

interface UnitFilters {
  status?: UnitStatus;
  unitType?: UnitType;
  minPrice?: number;
  maxPrice?: number;
}

/**
 * Lista desarrollos con filtros y conteo de unidades por estado.
 */
export async function getDevelopments(filters: DevelopmentFilters = {}) {
  const session = await getServerSession();
  if (!session?.user) throw new Error("No autorizado");

  const where: Prisma.DevelopmentWhereInput = {
    deletedAt: null,
  };

  if (filters.plaza) where.plaza = filters.plaza;
  if (filters.status) where.status = filters.status;
  if (filters.developmentType) where.developmentType = filters.developmentType;
  if (filters.isActive !== undefined) where.isActive = filters.isActive;
  if (filters.search) {
    where.OR = [
      { name: { contains: filters.search, mode: "insensitive" } },
      { developerName: { contains: filters.search, mode: "insensitive" } },
      { location: { contains: filters.search, mode: "insensitive" } },
    ];
  }

  const developments = await prisma.development.findMany({
    where,
    include: {
      units: {
        where: { deletedAt: null },
        select: { status: true },
      },
      _count: { select: { deals: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  // Calcular conteo de unidades por estado para cada desarrollo
  return developments.map((dev) => {
    const unitCounts = {
      disponible: dev.units.filter((u) => u.status === "DISPONIBLE").length,
      apartada: dev.units.filter((u) => u.status === "APARTADA").length,
      vendida: dev.units.filter((u) => u.status === "VENDIDA").length,
      noDisponible: dev.units.filter((u) => u.status === "NO_DISPONIBLE").length,
      total: dev.units.length,
    };

    // Excluir el array completo de units para no enviar datos innecesarios
    const { units, ...rest } = dev;
    return { ...rest, unitCounts };
  });
}

/**
 * Obtiene un desarrollo individual con todas sus unidades.
 */
export async function getDevelopment(id: string) {
  const session = await getServerSession();
  if (!session?.user) throw new Error("No autorizado");

  const development = await prisma.development.findUnique({
    where: { id, deletedAt: null },
    include: {
      units: {
        where: { deletedAt: null },
        orderBy: { unitNumber: "asc" },
        include: {
          reservedByContact: {
            select: { id: true, firstName: true, lastName: true },
          },
          reservedByUser: {
            select: { id: true, name: true },
          },
          _count: { select: { deals: true } },
        },
      },
      deals: {
        where: { deletedAt: null, stage: { notIn: ["LOST", "FROZEN"] } },
        select: {
          id: true, stage: true, estimatedValue: true, createdAt: true,
          contact: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 20,
      },
      _count: { select: { deals: true } },
    },
  });

  return development;
}

/**
 * Crea un nuevo desarrollo inmobiliario. Solo admin.
 */
export async function createDevelopment(data: {
  name: string;
  developerName: string;
  developmentType: string;
  location: string;
  plaza: string;
  totalUnits: number;
  availableUnits: number;
  priceMin: number;
  priceMax: number;
  currency?: string;
  totalDevelopmentValue?: number;
  commissionRate: number;
  status?: string;
  constructionProgress?: number;
  deliveryDate?: string | Date;
  contractStartDate?: string | Date;
  contractEndDate?: string | Date;
  brochureUrl?: string;
  virtualTourUrl?: string;
  amenities?: string[];
  description: string;
}) {
  const session = await getServerSession();
  if (!session?.user) throw new Error("No autorizado");

  if (!ADMIN_ROLES.includes(session.user.role)) {
    throw new Error("Solo Director, Gerente o Developer pueden crear desarrollos");
  }

  if (data.priceMax < data.priceMin) {
    throw new Error("El precio máximo no puede ser menor al mínimo");
  }

  const development = await prisma.development.create({
    data: {
      name: data.name,
      developerName: data.developerName,
      developmentType: data.developmentType as any,
      location: data.location,
      plaza: data.plaza as any,
      totalUnits: data.totalUnits,
      availableUnits: data.availableUnits,
      priceMin: data.priceMin,
      priceMax: data.priceMax,
      currency: (data.currency || "MXN") as any,
      totalDevelopmentValue: data.totalDevelopmentValue || null,
      commissionRate: data.commissionRate,
      status: (data.status || "PREVENTA") as any,
      constructionProgress: data.constructionProgress || 0,
      deliveryDate: data.deliveryDate ? new Date(data.deliveryDate as string) : null,
      contractStartDate: data.contractStartDate ? new Date(data.contractStartDate as string) : null,
      contractEndDate: data.contractEndDate ? new Date(data.contractEndDate as string) : null,
      brochureUrl: data.brochureUrl || null,
      virtualTourUrl: data.virtualTourUrl || null,
      amenities: data.amenities || [],
      description: data.description,
    },
  });

  return development;
}

/**
 * Actualiza un desarrollo existente. Solo admin.
 */
export async function updateDevelopment(
  id: string,
  data: Partial<{
    name: string;
    developerName: string;
    developmentType: string;
    location: string;
    plaza: string;
    totalUnits: number;
    availableUnits: number;
    priceMin: number;
    priceMax: number;
    currency: string;
    totalDevelopmentValue: number;
    commissionRate: number;
    status: string;
    constructionProgress: number;
    deliveryDate: string | Date;
    contractStartDate: string | Date;
    contractEndDate: string | Date;
    brochureUrl: string;
    virtualTourUrl: string;
    amenities: string[];
    description: string;
    isActive: boolean;
  }>
) {
  const session = await getServerSession();
  if (!session?.user) throw new Error("No autorizado");

  if (!ADMIN_ROLES.includes(session.user.role)) {
    throw new Error("Solo Director, Gerente o Developer pueden editar desarrollos");
  }

  const updateData: any = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.developerName !== undefined) updateData.developerName = data.developerName;
  if (data.developmentType !== undefined) updateData.developmentType = data.developmentType;
  if (data.location !== undefined) updateData.location = data.location;
  if (data.plaza !== undefined) updateData.plaza = data.plaza;
  if (data.totalUnits !== undefined) updateData.totalUnits = data.totalUnits;
  if (data.availableUnits !== undefined) updateData.availableUnits = data.availableUnits;
  if (data.priceMin !== undefined) updateData.priceMin = data.priceMin;
  if (data.priceMax !== undefined) updateData.priceMax = data.priceMax;
  if (data.currency !== undefined) updateData.currency = data.currency;
  if (data.totalDevelopmentValue !== undefined) updateData.totalDevelopmentValue = data.totalDevelopmentValue;
  if (data.commissionRate !== undefined) updateData.commissionRate = data.commissionRate;
  if (data.status !== undefined) updateData.status = data.status;
  if (data.constructionProgress !== undefined) updateData.constructionProgress = data.constructionProgress;
  if (data.deliveryDate !== undefined) updateData.deliveryDate = data.deliveryDate ? new Date(data.deliveryDate as string) : null;
  if (data.contractStartDate !== undefined) updateData.contractStartDate = data.contractStartDate ? new Date(data.contractStartDate as string) : null;
  if (data.contractEndDate !== undefined) updateData.contractEndDate = data.contractEndDate ? new Date(data.contractEndDate as string) : null;
  if (data.brochureUrl !== undefined) updateData.brochureUrl = data.brochureUrl;
  if (data.virtualTourUrl !== undefined) updateData.virtualTourUrl = data.virtualTourUrl;
  if (data.amenities !== undefined) updateData.amenities = data.amenities;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.isActive !== undefined) updateData.isActive = data.isActive;

  return prisma.development.update({
    where: { id },
    data: updateData,
  });
}

/**
 * Lista unidades de un desarrollo con filtros.
 */
export async function getUnits(developmentId: string, filters: UnitFilters = {}) {
  const session = await getServerSession();
  if (!session?.user) throw new Error("No autorizado");

  const where: Prisma.UnitWhereInput = {
    developmentId,
    deletedAt: null,
  };

  if (filters.status) where.status = filters.status;
  if (filters.unitType) where.unitType = filters.unitType;
  if (filters.minPrice || filters.maxPrice) {
    where.price = {};
    if (filters.minPrice) (where.price as any).gte = filters.minPrice;
    if (filters.maxPrice) (where.price as any).lte = filters.maxPrice;
  }

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
    orderBy: { unitNumber: "asc" },
  });

  return units;
}

/**
 * Actualiza estado y/o precio de una unidad.
 */
export async function updateUnit(
  id: string,
  data: {
    status?: string;
    price?: number;
    reservedByContactId?: string | null;
    reservedByUserId?: string | null;
  }
) {
  const session = await getServerSession();
  if (!session?.user) throw new Error("No autorizado");

  const updateData: any = {};
  if (data.status) updateData.status = data.status;
  if (data.price) updateData.price = data.price;
  if (data.reservedByContactId !== undefined) updateData.reservedByContactId = data.reservedByContactId;
  if (data.reservedByUserId !== undefined) updateData.reservedByUserId = data.reservedByUserId;

  return prisma.unit.update({
    where: { id },
    data: updateData,
  });
}

/**
 * Estadísticas de desarrollos: tasa de absorción, velocidad de ventas.
 */
export async function getDevelopmentStats() {
  const session = await getServerSession();
  if (!session?.user) throw new Error("No autorizado");

  const developments = await prisma.development.findMany({
    where: { deletedAt: null, isActive: true },
    include: {
      units: {
        where: { deletedAt: null },
        select: {
          status: true,
          saleDate: true,
          price: true,
          salePrice: true,
        },
      },
    },
  });

  return developments.map((dev) => {
    const totalUnits = dev.units.length;
    const soldUnits = dev.units.filter((u) => u.status === "VENDIDA").length;
    const reservedUnits = dev.units.filter((u) => u.status === "APARTADA").length;
    const availableUnits = dev.units.filter((u) => u.status === "DISPONIBLE").length;

    // Tasa de absorción: % vendido del total
    const absorptionRate = totalUnits > 0 ? (soldUnits / totalUnits) * 100 : 0;

    // Ingreso total por ventas
    const totalRevenue = dev.units
      .filter((u) => u.status === "VENDIDA" && u.salePrice)
      .reduce((sum, u) => sum + Number(u.salePrice || 0), 0);

    // Días promedio de venta
    const soldWithDates = dev.units.filter((u) => u.saleDate);
    const avgDaysToSell = soldWithDates.length > 0
      ? soldWithDates.reduce((sum, u) => {
          const days = Math.floor(
            (new Date(u.saleDate!).getTime() - dev.createdAt.getTime()) /
              (1000 * 60 * 60 * 24)
          );
          return sum + Math.max(days, 0);
        }, 0) / soldWithDates.length
      : 0;

    return {
      id: dev.id,
      name: dev.name,
      plaza: dev.plaza,
      status: dev.status,
      totalUnits,
      soldUnits,
      reservedUnits,
      availableUnits,
      absorptionRate: Math.round(absorptionRate * 10) / 10,
      totalRevenue,
      avgDaysToSell: Math.round(avgDaysToSell),
    };
  });
}
