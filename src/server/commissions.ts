// ============================================================
// Server Actions: Gestión de comisiones
// Consulta de deals ganados, actualización de estado de pago
// ============================================================

"use server";

import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import type { Prisma, CommissionStatus } from "@prisma/client";

// Roles con acceso completo a todas las comisiones
const FULL_ACCESS_ROLES = ["DIRECTOR"];
// Roles con acceso a comisiones de su plaza
const PLAZA_ACCESS_ROLES = ["GERENTE"];
// Roles con acceso a comisiones de su equipo
const TEAM_ACCESS_ROLES = ["TEAM_LEADER"];
// Roles con acceso solo a sus propias comisiones
const OWN_ACCESS_ROLES = ["ASESOR_SR", "ASESOR_JR"];

// Roles que pueden cambiar estado de comisión
const STATUS_CHANGE_ROLES = ["DIRECTOR", "GERENTE"];

// Transiciones válidas de estado de comisión (solo hacia adelante)
const VALID_TRANSITIONS: Record<CommissionStatus, CommissionStatus[]> = {
  PENDIENTE: ["FACTURADA"],
  FACTURADA: ["PAGADA"],
  PAGADA: [],
};

// --- Tipos ---
interface CommissionFilters {
  status?: CommissionStatus;
  userId?: string;
  dateFrom?: string;
  dateTo?: string;
}

interface CommissionRecord {
  id: string;
  contactName: string;
  developmentName: string | null;
  dealType: string;
  advisorName: string;
  estimatedValue: number;
  currency: string;
  commissionTotal: number;
  commissionAdvisor: number;
  commissionTL: number;
  commissionGerente: number;
  commissionDirector: number;
  commissionBrokerExt: number;
  commissionStatus: CommissionStatus;
  actualCloseDate: string | null;
  createdAt: string;
}

interface CommissionTotals {
  pendiente: number;
  facturada: number;
  pagada: number;
}

interface CommissionsResult {
  commissions: CommissionRecord[];
  totals: CommissionTotals;
}

/**
 * Construye filtro RBAC para comisiones.
 * Director = todas, Gerente = plaza, TL = equipo, Asesor = propias.
 */
async function buildCommissionRBACFilter(
  userId: string,
  userRole: string,
  userPlaza: string
): Promise<Prisma.DealWhereInput> {
  // Director ve todo
  if (FULL_ACCESS_ROLES.includes(userRole)) {
    return { deletedAt: null };
  }

  // Gerente ve comisiones de asesores de su plaza
  if (PLAZA_ACCESS_ROLES.includes(userRole)) {
    return {
      deletedAt: null,
      assignedTo: { plaza: userPlaza as Prisma.EnumPlazaFilter },
    };
  }

  // Team Leader ve comisiones de su equipo
  if (TEAM_ACCESS_ROLES.includes(userRole)) {
    const teamMembers = await prisma.user.findMany({
      where: { teamLeaderId: userId },
      select: { id: true },
    });
    const teamIds = [userId, ...teamMembers.map((m) => m.id)];
    return {
      deletedAt: null,
      assignedToId: { in: teamIds },
    };
  }

  // Asesor ve solo sus propias comisiones
  return {
    deletedAt: null,
    assignedToId: userId,
  };
}

/**
 * Obtiene comisiones (deals ganados o con commissionStatus asignado).
 * Soporta filtros por estado, usuario y rango de fechas.
 * Retorna registros + totales por estado.
 */
export async function getCommissions(
  filters: CommissionFilters = {}
): Promise<CommissionsResult> {
  const session = await getServerSession();
  if (!session?.user) throw new Error("No autorizado");

  const { status, userId, dateFrom, dateTo } = filters;

  // Construir filtro RBAC base
  const rbacFilter = await buildCommissionRBACFilter(
    session.user.id,
    session.user.role,
    session.user.plaza
  );

  // Condición principal: deals ganados O con commissionStatus definido
  const where: Prisma.DealWhereInput = {
    ...rbacFilter,
    OR: [
      { stage: "WON" },
      { commissionStatus: { not: undefined } },
    ],
  };

  // Filtro por estado de comisión
  if (status) {
    where.commissionStatus = status;
  }

  // Filtro por usuario asignado
  if (userId) {
    where.assignedToId = userId;
  }

  // Filtro por rango de fechas
  if (dateFrom || dateTo) {
    where.createdAt = {};
    if (dateFrom) {
      (where.createdAt as Prisma.DateTimeFilter).gte = new Date(dateFrom);
    }
    if (dateTo) {
      (where.createdAt as Prisma.DateTimeFilter).lte = new Date(dateTo);
    }
  }

  // Consultar deals con relaciones necesarias
  const deals = await prisma.deal.findMany({
    where,
    include: {
      contact: {
        select: { firstName: true, lastName: true },
      },
      development: {
        select: { name: true },
      },
      assignedTo: {
        select: { name: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // Transformar deals a registros de comisión
  const commissions: CommissionRecord[] = deals.map((deal) => ({
    id: deal.id,
    contactName: `${deal.contact.firstName} ${deal.contact.lastName}`,
    developmentName: deal.development?.name ?? null,
    dealType: deal.dealType,
    advisorName: deal.assignedTo.name,
    estimatedValue: Number(deal.estimatedValue),
    currency: deal.currency,
    commissionTotal: Number(deal.commissionTotal ?? 0),
    commissionAdvisor: Number(deal.commissionAdvisor ?? 0),
    commissionTL: Number(deal.commissionTL ?? 0),
    commissionGerente: Number(deal.commissionGerente ?? 0),
    commissionDirector: Number(deal.commissionDirector ?? 0),
    commissionBrokerExt: Number(deal.commissionBrokerExt ?? 0),
    commissionStatus: deal.commissionStatus,
    actualCloseDate: deal.actualCloseDate?.toISOString() ?? null,
    createdAt: deal.createdAt.toISOString(),
  }));

  // Calcular totales por estado
  const totals: CommissionTotals = { pendiente: 0, facturada: 0, pagada: 0 };
  for (const c of commissions) {
    switch (c.commissionStatus) {
      case "PENDIENTE":
        totals.pendiente += c.commissionTotal;
        break;
      case "FACTURADA":
        totals.facturada += c.commissionTotal;
        break;
      case "PAGADA":
        totals.pagada += c.commissionTotal;
        break;
    }
  }

  return { commissions, totals };
}

/**
 * Actualiza el estado de comisión de un deal.
 * Solo DIRECTOR y GERENTE pueden ejecutar esta acción.
 * Valida transiciones: PENDIENTE → FACTURADA → PAGADA (sin retroceder).
 * Crea registro de auditoría.
 */
export async function updateCommissionStatus(
  dealId: string,
  newStatus: CommissionStatus
): Promise<{ success: boolean; message: string }> {
  const session = await getServerSession();
  if (!session?.user) throw new Error("No autorizado");

  // Verificar permisos de rol
  if (!STATUS_CHANGE_ROLES.includes(session.user.role)) {
    throw new Error("Solo Director y Gerente pueden cambiar el estado de comisiones");
  }

  // Obtener deal actual
  const deal = await prisma.deal.findUnique({
    where: { id: dealId, deletedAt: null },
    select: {
      id: true,
      commissionStatus: true,
      commissionTotal: true,
      assignedTo: { select: { name: true, plaza: true } },
    },
  });

  if (!deal) {
    throw new Error("Deal no encontrado");
  }

  // Gerente solo puede cambiar comisiones de su plaza
  if (
    session.user.role === "GERENTE" &&
    deal.assignedTo.plaza !== session.user.plaza
  ) {
    throw new Error("No tienes permisos para modificar comisiones de otra plaza");
  }

  // Validar transición de estado
  const currentStatus = deal.commissionStatus;
  const allowedTransitions = VALID_TRANSITIONS[currentStatus];

  if (!allowedTransitions.includes(newStatus)) {
    throw new Error(
      `Transición no válida: ${currentStatus} → ${newStatus}. ` +
      `Transiciones permitidas: ${allowedTransitions.join(", ") || "ninguna"}`
    );
  }

  // Actualizar estado de comisión
  await prisma.deal.update({
    where: { id: dealId },
    data: { commissionStatus: newStatus },
  });

  // Crear registro de auditoría
  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: "UPDATE",
      entity: "Deal",
      entityId: dealId,
      changes: {
        field: "commissionStatus",
        from: currentStatus,
        to: newStatus,
      },
    },
  });

  return {
    success: true,
    message: `Estado de comisión actualizado a ${newStatus}`,
  };
}
