// ============================================================
// Server Actions: Reportes
// Generación de reportes de pipeline, absorción, comisiones,
// actividades, fuentes de leads, forecast y deals perdidos
// ============================================================

"use server";

import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { STAGNATION_LIMITS } from "@/lib/constants";
import type { Prisma } from "@prisma/client";

// --- Interfaces de filtros ---
export interface ReportFilters {
  dateFrom?: string;
  dateTo?: string;
  plaza?: string;
  advisorId?: string;
  developmentId?: string;
  teamLeaderId?: string;
  status?: string;
}

// ============================================================
// Reporte de Pipeline
// ============================================================

export interface PipelineReportRow {
  stage: string;
  count: number;
  totalValue: number;
  avgDaysInStage: number;
  stagnantCount: number;
}

/**
 * Reporte de pipeline: deals agrupados por etapa con conteo, valor total,
 * promedio de días en etapa y cantidad de deals estancados.
 */
export async function getPipelineReport(
  filters: ReportFilters = {}
): Promise<PipelineReportRow[]> {
  const session = await getServerSession();
  if (!session?.user) throw new Error("No autorizado");

  const where: Prisma.DealWhereInput = { deletedAt: null };

  // Filtros opcionales
  if (filters.dateFrom || filters.dateTo) {
    where.createdAt = {};
    if (filters.dateFrom) (where.createdAt as any).gte = new Date(filters.dateFrom);
    if (filters.dateTo) (where.createdAt as any).lte = new Date(filters.dateTo);
  }
  if (filters.plaza) {
    where.assignedTo = { plaza: filters.plaza as any };
  }
  if (filters.advisorId) {
    where.assignedToId = filters.advisorId;
  }

  // Agrupar por etapa
  const aggregations = await prisma.deal.groupBy({
    by: ["stage"],
    where,
    _count: { id: true },
    _sum: { estimatedValue: true },
  });

  // Obtener todos los deals activos para calcular días en etapa y estancamiento
  const deals = await prisma.deal.findMany({
    where,
    select: {
      stage: true,
      updatedAt: true,
      createdAt: true,
      activities: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { createdAt: true },
      },
    },
  });

  const now = new Date();
  const stageData = new Map<
    string,
    { totalDays: number; count: number; stagnant: number }
  >();

  for (const deal of deals) {
    const entry = stageData.get(deal.stage) || {
      totalDays: 0,
      count: 0,
      stagnant: 0,
    };
    // Días desde última actualización
    const daysSinceUpdate = Math.floor(
      (now.getTime() - new Date(deal.updatedAt).getTime()) / (1000 * 60 * 60 * 24)
    );
    entry.totalDays += daysSinceUpdate;
    entry.count += 1;

    // Estancamiento: sin actividad mayor al límite
    const stagnationLimit = STAGNATION_LIMITS[deal.stage] || 7;
    const lastActivity = deal.activities[0]?.createdAt || deal.createdAt;
    const daysSinceActivity = Math.floor(
      (now.getTime() - new Date(lastActivity).getTime()) / (1000 * 60 * 60 * 24)
    );
    if (
      daysSinceActivity > stagnationLimit &&
      !["WON", "LOST", "FROZEN"].includes(deal.stage)
    ) {
      entry.stagnant += 1;
    }

    stageData.set(deal.stage, entry);
  }

  return aggregations.map((agg) => {
    const data = stageData.get(agg.stage);
    return {
      stage: agg.stage,
      count: agg._count.id,
      totalValue: Number(agg._sum.estimatedValue || 0),
      avgDaysInStage: data && data.count > 0 ? Math.round(data.totalDays / data.count) : 0,
      stagnantCount: data?.stagnant || 0,
    };
  });
}

// ============================================================
// Reporte de Absorción
// ============================================================

export interface AbsorptionReportRow {
  developmentId: string;
  developmentName: string;
  totalUnits: number;
  soldUnits: number;
  reservedUnits: number;
  availableUnits: number;
  absorptionRate: number;
  avgPrice: number;
}

/**
 * Reporte de absorción por desarrollo: unidades totales, vendidas,
 * reservadas, disponibles y tasa de absorción mensual.
 */
export async function getAbsorptionReport(
  filters: ReportFilters = {}
): Promise<AbsorptionReportRow[]> {
  const session = await getServerSession();
  if (!session?.user) throw new Error("No autorizado");

  const where: Prisma.DevelopmentWhereInput = { deletedAt: null, isActive: true };
  if (filters.plaza) where.plaza = filters.plaza as any;
  if (filters.developmentId) where.id = filters.developmentId;

  const developments = await prisma.development.findMany({
    where,
    select: {
      id: true,
      name: true,
      totalUnits: true,
      soldUnits: true,
      reservedUnits: true,
      availableUnits: true,
      priceMin: true,
      priceMax: true,
      createdAt: true,
    },
    orderBy: { name: "asc" },
  });

  const now = new Date();

  return developments.map((dev) => {
    // Calcular meses desde el primer registro (aprox primera venta)
    const monthsSinceStart = Math.max(
      1,
      Math.floor(
        (now.getTime() - new Date(dev.createdAt).getTime()) /
          (1000 * 60 * 60 * 24 * 30)
      )
    );

    // Tasa de absorción: unidades vendidas / meses desde inicio
    const absorptionRate =
      monthsSinceStart > 0
        ? Math.round((dev.soldUnits / monthsSinceStart) * 10) / 10
        : 0;

    const avgPrice = (Number(dev.priceMin) + Number(dev.priceMax)) / 2;

    return {
      developmentId: dev.id,
      developmentName: dev.name,
      totalUnits: dev.totalUnits,
      soldUnits: dev.soldUnits,
      reservedUnits: dev.reservedUnits,
      availableUnits: dev.availableUnits,
      absorptionRate,
      avgPrice: Math.round(avgPrice),
    };
  });
}

// ============================================================
// Reporte de Comisiones
// ============================================================

export interface CommissionsReportRow {
  advisorId: string;
  advisorName: string;
  totalCommission: number;
  pendingCommission: number;
  paidCommission: number;
  dealCount: number;
}

/**
 * Reporte de comisiones agrupadas por asesor: total, pendiente y pagado.
 */
export async function getCommissionsReport(
  filters: ReportFilters = {}
): Promise<CommissionsReportRow[]> {
  const session = await getServerSession();
  if (!session?.user) throw new Error("No autorizado");

  const where: Prisma.DealWhereInput = {
    deletedAt: null,
    stage: "WON",
    commissionAdvisor: { not: null },
  };

  if (filters.dateFrom || filters.dateTo) {
    where.actualCloseDate = {};
    if (filters.dateFrom) (where.actualCloseDate as any).gte = new Date(filters.dateFrom);
    if (filters.dateTo) (where.actualCloseDate as any).lte = new Date(filters.dateTo);
  }
  if (filters.status) {
    where.commissionStatus = filters.status as any;
  }

  const deals = await prisma.deal.findMany({
    where,
    select: {
      assignedToId: true,
      assignedTo: { select: { name: true } },
      commissionAdvisor: true,
      commissionStatus: true,
    },
  });

  // Agrupar por asesor
  const advisorMap = new Map<
    string,
    { name: string; total: number; pending: number; paid: number; count: number }
  >();

  for (const deal of deals) {
    const entry = advisorMap.get(deal.assignedToId) || {
      name: deal.assignedTo.name,
      total: 0,
      pending: 0,
      paid: 0,
      count: 0,
    };

    const amount = Number(deal.commissionAdvisor || 0);
    entry.total += amount;
    entry.count += 1;

    if (deal.commissionStatus === "PAGADA") {
      entry.paid += amount;
    } else {
      entry.pending += amount;
    }

    advisorMap.set(deal.assignedToId, entry);
  }

  return Array.from(advisorMap.entries()).map(([id, data]) => ({
    advisorId: id,
    advisorName: data.name,
    totalCommission: Math.round(data.total),
    pendingCommission: Math.round(data.pending),
    paidCommission: Math.round(data.paid),
    dealCount: data.count,
  }));
}

// ============================================================
// Reporte de Actividades
// ============================================================

export interface ActivitiesReportRow {
  advisorId: string;
  advisorName: string;
  callsOut: number;
  whatsappOut: number;
  emailsSent: number;
  meetings: number;
  discoveries: number;
  proposals: number;
  followUps: number;
  total: number;
}

/**
 * Reporte de actividades por asesor y tipo de actividad.
 */
export async function getActivitiesReport(
  filters: ReportFilters = {}
): Promise<ActivitiesReportRow[]> {
  const session = await getServerSession();
  if (!session?.user) throw new Error("No autorizado");

  const where: Prisma.ActivityWhereInput = { deletedAt: null };

  if (filters.dateFrom || filters.dateTo) {
    where.createdAt = {};
    if (filters.dateFrom) (where.createdAt as any).gte = new Date(filters.dateFrom);
    if (filters.dateTo) (where.createdAt as any).lte = new Date(filters.dateTo);
  }
  if (filters.advisorId) where.userId = filters.advisorId;
  if (filters.teamLeaderId) {
    // Filtrar por miembros del equipo
    const teamMembers = await prisma.user.findMany({
      where: { teamLeaderId: filters.teamLeaderId },
      select: { id: true },
    });
    where.userId = {
      in: [filters.teamLeaderId, ...teamMembers.map((m) => m.id)],
    };
  }

  const activities = await prisma.activity.findMany({
    where,
    select: {
      userId: true,
      user: { select: { name: true } },
      activityType: true,
    },
  });

  // Agrupar por asesor
  const advisorMap = new Map<
    string,
    {
      name: string;
      callsOut: number;
      whatsappOut: number;
      emailsSent: number;
      meetings: number;
      discoveries: number;
      proposals: number;
      followUps: number;
      total: number;
    }
  >();

  for (const act of activities) {
    const entry = advisorMap.get(act.userId) || {
      name: act.user.name,
      callsOut: 0,
      whatsappOut: 0,
      emailsSent: 0,
      meetings: 0,
      discoveries: 0,
      proposals: 0,
      followUps: 0,
      total: 0,
    };

    entry.total += 1;
    switch (act.activityType) {
      case "CALL_OUTBOUND":
        entry.callsOut += 1;
        break;
      case "WHATSAPP_OUT":
        entry.whatsappOut += 1;
        break;
      case "EMAIL_SENT":
        entry.emailsSent += 1;
        break;
      case "MEETING_VIRTUAL":
      case "MEETING_PRESENTIAL":
      case "MEETING_SHOWROOM":
        entry.meetings += 1;
        break;
      case "DISCOVERY_CALL":
        entry.discoveries += 1;
        break;
      case "PROPOSAL_DELIVERY":
        entry.proposals += 1;
        break;
      case "FOLLOW_UP":
        entry.followUps += 1;
        break;
    }

    advisorMap.set(act.userId, entry);
  }

  return Array.from(advisorMap.entries()).map(([id, data]) => ({
    advisorId: id,
    advisorName: data.name,
    ...data,
  }));
}

// ============================================================
// Reporte de Fuentes de Leads
// ============================================================

export interface LeadSourcesReportRow {
  leadSource: string;
  totalContacts: number;
  convertedToDeals: number;
  wonDeals: number;
  conversionRate: number;
  avgDealValue: number;
}

/**
 * Reporte de fuentes de leads con conteo, conversión y valor promedio.
 */
export async function getLeadSourcesReport(
  filters: ReportFilters = {}
): Promise<LeadSourcesReportRow[]> {
  const session = await getServerSession();
  if (!session?.user) throw new Error("No autorizado");

  const contactWhere: Prisma.ContactWhereInput = { deletedAt: null };
  if (filters.dateFrom || filters.dateTo) {
    contactWhere.createdAt = {};
    if (filters.dateFrom) (contactWhere.createdAt as any).gte = new Date(filters.dateFrom);
    if (filters.dateTo) (contactWhere.createdAt as any).lte = new Date(filters.dateTo);
  }

  // Agrupar contactos por fuente
  const contactsBySource = await prisma.contact.groupBy({
    by: ["leadSource"],
    where: contactWhere,
    _count: { id: true },
  });

  const results: LeadSourcesReportRow[] = [];

  for (const group of contactsBySource) {
    // Deals creados a partir de contactos de esta fuente
    const dealWhere: Prisma.DealWhereInput = {
      deletedAt: null,
      leadSourceAtDeal: group.leadSource,
    };
    if (filters.dateFrom || filters.dateTo) {
      dealWhere.createdAt = {};
      if (filters.dateFrom) (dealWhere.createdAt as any).gte = new Date(filters.dateFrom);
      if (filters.dateTo) (dealWhere.createdAt as any).lte = new Date(filters.dateTo);
    }

    const [totalDeals, wonDeals, avgValue] = await Promise.all([
      prisma.deal.count({ where: dealWhere }),
      prisma.deal.count({ where: { ...dealWhere, stage: "WON" } }),
      prisma.deal.aggregate({
        where: { ...dealWhere, stage: "WON" },
        _avg: { estimatedValue: true },
      }),
    ]);

    results.push({
      leadSource: group.leadSource,
      totalContacts: group._count.id,
      convertedToDeals: totalDeals,
      wonDeals,
      conversionRate:
        group._count.id > 0
          ? Math.round((wonDeals / group._count.id) * 100 * 10) / 10
          : 0,
      avgDealValue: Math.round(Number(avgValue._avg.estimatedValue || 0)),
    });
  }

  return results.sort((a, b) => b.totalContacts - a.totalContacts);
}

// ============================================================
// Reporte de Forecast
// ============================================================

export interface ForecastReportRow {
  month: string;
  dealCount: number;
  totalEstimatedValue: number;
  weightedValue: number;
}

/**
 * Reporte de forecast: deals activos con valor ponderado por probabilidad,
 * agrupados por mes de expectedCloseDate.
 */
export async function getForecastReport(
  filters: ReportFilters = {}
): Promise<ForecastReportRow[]> {
  const session = await getServerSession();
  if (!session?.user) throw new Error("No autorizado");

  const where: Prisma.DealWhereInput = {
    deletedAt: null,
    stage: { notIn: ["WON", "LOST", "FROZEN"] },
  };

  if (filters.plaza) {
    where.assignedTo = { plaza: filters.plaza as any };
  }
  if (filters.advisorId) where.assignedToId = filters.advisorId;

  const deals = await prisma.deal.findMany({
    where,
    select: {
      expectedCloseDate: true,
      estimatedValue: true,
      probability: true,
    },
  });

  // Agrupar por mes de cierre esperado
  const monthMap = new Map<
    string,
    { count: number; total: number; weighted: number }
  >();

  for (const deal of deals) {
    const d = new Date(deal.expectedCloseDate);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const entry = monthMap.get(key) || { count: 0, total: 0, weighted: 0 };
    const value = Number(deal.estimatedValue);
    entry.count += 1;
    entry.total += value;
    entry.weighted += value * (deal.probability / 100);
    monthMap.set(key, entry);
  }

  // Ordenar por mes
  return Array.from(monthMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, data]) => ({
      month,
      dealCount: data.count,
      totalEstimatedValue: Math.round(data.total),
      weightedValue: Math.round(data.weighted),
    }));
}

// ============================================================
// Reporte de Deals Perdidos
// ============================================================

export interface LostDealsReportRow {
  lostReason: string;
  count: number;
  totalValueLost: number;
  byStage: Record<string, number>;
  byAdvisor: Record<string, number>;
}

/**
 * Reporte de deals perdidos agrupados por razón de pérdida.
 * Incluye desglose por etapa al momento de pérdida y por asesor.
 */
export async function getLostDealsReport(
  filters: ReportFilters = {}
): Promise<LostDealsReportRow[]> {
  const session = await getServerSession();
  if (!session?.user) throw new Error("No autorizado");

  const where: Prisma.DealWhereInput = {
    deletedAt: null,
    stage: "LOST",
    lostReason: { not: null },
  };

  if (filters.dateFrom || filters.dateTo) {
    where.updatedAt = {};
    if (filters.dateFrom) (where.updatedAt as any).gte = new Date(filters.dateFrom);
    if (filters.dateTo) (where.updatedAt as any).lte = new Date(filters.dateTo);
  }
  if (filters.plaza) {
    where.assignedTo = { plaza: filters.plaza as any };
  }
  if (filters.advisorId) where.assignedToId = filters.advisorId;

  const deals = await prisma.deal.findMany({
    where,
    select: {
      lostReason: true,
      estimatedValue: true,
      assignedTo: { select: { name: true } },
      // Usamos leadSourceAtDeal como proxy de la etapa previa (se registra en actividad)
      activities: {
        where: {
          subject: { startsWith: "Cambio de etapa" },
        },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { subject: true },
      },
    },
  });

  // Agrupar por razón de pérdida
  const reasonMap = new Map<
    string,
    {
      count: number;
      totalValue: number;
      byStage: Record<string, number>;
      byAdvisor: Record<string, number>;
    }
  >();

  for (const deal of deals) {
    const reason = deal.lostReason || "SIN_RAZON";
    const entry = reasonMap.get(reason) || {
      count: 0,
      totalValue: 0,
      byStage: {},
      byAdvisor: {},
    };

    entry.count += 1;
    entry.totalValue += Number(deal.estimatedValue);

    // Extraer etapa previa del subject de la actividad de cambio
    const lastStageChange = deal.activities[0]?.subject || "";
    // Formato: "Cambio de etapa: X → Perdido"
    const match = lastStageChange.match(/:\s*(.+?)\s*→/);
    const prevStage = match ? match[1].trim() : "Desconocida";
    entry.byStage[prevStage] = (entry.byStage[prevStage] || 0) + 1;

    // Por asesor
    const advisorName = deal.assignedTo.name;
    entry.byAdvisor[advisorName] = (entry.byAdvisor[advisorName] || 0) + 1;

    reasonMap.set(reason, entry);
  }

  return Array.from(reasonMap.entries())
    .map(([reason, data]) => ({
      lostReason: reason,
      count: data.count,
      totalValueLost: Math.round(data.totalValue),
      byStage: data.byStage,
      byAdvisor: data.byAdvisor,
    }))
    .sort((a, b) => b.count - a.count);
}
