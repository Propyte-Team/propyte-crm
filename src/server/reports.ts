// ============================================================
// Server Actions: Reportes
// Generación de reportes de pipeline, absorción, comisiones,
// actividades, fuentes de leads, forecast y deals perdidos
// ============================================================

"use server";

import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { PLAZA_LABELS, STAGNATION_LIMITS } from "@/lib/constants";
import type { Prisma } from "@prisma/client";
import { realLeadWhere } from "@/lib/leads/real-leads";
import { getVisibleBrands } from "@/lib/brands/user-access";
import {
  activityBrandVisibilityWhere,
  contactBrandVisibilityWhere,
  dealBrandVisibilityWhere,
} from "@/lib/brands/visibility";
import {
  SIN_ACCESO_REPORTES,
  alcanceActividadesReporte,
  alcanceComisionesReporte,
  alcanceContactosReporte,
  alcanceNegociosReporte,
  puedeVerReportes,
  type UsuarioParaReportes,
} from "@/lib/rbac/report-scope";
import { rangoDeFechas } from "@/lib/reports/rango-fechas";
import { inventarioParaReporte } from "@/lib/hub/catalog";

// Quién entra y qué ve (#893). Antes cada consulta solo pedía sesión: cualquier rol, aunque el
// menú le ocultara Reportes, veía las cifras de toda la empresa, comisiones incluidas.
//   · Puerta: los roles del menú (`puedeVerReportes`). El resto recibe «No autorizado».
//   · Alcance por rol: la matriz de la #869 (`lib/rbac/report-scope.ts`). Comisiones usa los
//     conjuntos del módulo Comisiones.
//   · Marca (2026-10-12, entrega 3, decisión 4 del dueño): sin selector, pero quien no es ADMIN
//     solo ve las marcas que tiene prendidas (visibility.ts: lo asignado a uno siempre cuenta).
// Rol y marca van juntos en `AND`, para que ningún filtro suelto (plaza, asesor, fechas) los pise:
// el filtro que pide la pantalla se INTERSECTA con el alcance, nunca lo reemplaza.
// Fuera: getAbsorptionReport. Es inventario del Hub, sin contactos ni negocios de por medio: no
// hay de dónde sacar ni la marca ni el dueño. Solo pasa por la puerta.

/** Sesión + puerta de entrada. Mismo mensaje que ya daban las consultas sin sesión. */
async function usuarioDeReportes(): Promise<UsuarioParaReportes> {
  const session = await getServerSession();
  if (!session?.user || !puedeVerReportes(session.user.role)) {
    throw new Error(SIN_ACCESO_REPORTES);
  }
  return session.user;
}

/** Junta las condiciones que existan para ponerlas en `AND`. `undefined` si no hay ninguna. */
function todas<T>(...condiciones: Array<T | undefined>): T[] | undefined {
  const presentes = condiciones.filter((c): c is T => c !== undefined);
  return presentes.length > 0 ? presentes : undefined;
}

/** Lo que cada consulta suma en `AND`: alcance por rol + marca. */
async function alcance(user: UsuarioParaReportes) {
  const visible = await getVisibleBrands(user);
  return {
    deal: todas(alcanceNegociosReporte(user), dealBrandVisibilityWhere(user, visible)),
    commission: todas(alcanceComisionesReporte(user), dealBrandVisibilityWhere(user, visible)),
    contact: todas(alcanceContactosReporte(user), contactBrandVisibilityWhere(user, visible)),
    activity: todas(alcanceActividadesReporte(user), activityBrandVisibilityWhere(user, visible)),
  };
}

// --- Interfaces de filtros ---
export interface ReportFilters {
  dateFrom?: string;
  dateTo?: string;
  plaza?: string;
  advisorId?: string;
  /** En Absorción es el id del desarrollo en el Hub. */
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
  const user = await usuarioDeReportes();

  const where: Prisma.DealWhereInput = { deletedAt: null };

  // Filtros opcionales
  const fechas = rangoDeFechas(filters.dateFrom, filters.dateTo);
  if (fechas) where.createdAt = fechas;
  if (filters.plaza) {
    where.assignedTo = { plaza: filters.plaza as any };
  }
  if (filters.advisorId) {
    where.assignedToId = filters.advisorId;
  }
  const acotado = (await alcance(user)).deal;
  if (acotado) where.AND = acotado;

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
  plaza: string;
  /** Contador de la ficha del desarrollo en el Hub; puede no coincidir con lo publicado. */
  totalUnits: number | null;
  publishedUnits: number;
  availableUnits: number;
  reservedUnits: number;
  soldUnits: number;
  /** Vendidas ÷ publicadas, en %. `null` sin unidades publicadas. */
  soldPct: number | null;
  /** Ventas por mes en la ventana. `null` si el desarrollo no tiene ninguna fecha de venta. */
  absorptionRate: number | null;
  avgPrice: number | null;
}

const DIA_MS = 86_400_000;
const DIAS_POR_MES = 365.25 / 12;

function normalizarPlaza(texto: string): string {
  return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

/** Cómo puede venir escrita en el Hub (texto libre) una plaza del CRM: su código o su etiqueta. */
function plazaEnElHub(codigo: string): string[] {
  const nombres = [codigo, PLAZA_LABELS[codigo]].filter((n): n is string => !!n);
  return Array.from(new Set(nombres.map(normalizarPlaza)));
}

/** Etiqueta del CRM para la plaza que trae el Hub; si no corresponde a ninguna, el texto tal cual. */
function etiquetaDePlaza(textoHub: string | null): string {
  if (!textoHub) return "Sin plaza";
  const n = normalizarPlaza(textoHub);
  const codigo = Object.keys(PLAZA_LABELS).find((c) => plazaEnElHub(c).includes(n));
  return codigo ? PLAZA_LABELS[codigo] : textoHub;
}

/**
 * Reporte de absorción por desarrollo, desde el inventario PUBLICADO del Hub (#893).
 *
 * Antes leía `propyte_crm.developments`, que está vacía y deprecada (ver
 * `server/developments.ts`): el reporte salía siempre sin datos. Ahora cuenta las unidades
 * publicadas de cada desarrollo por estado.
 *
 * Absorción/mes = unidades con fecha de venta (`sold_at`) dentro de la ventana ÷ meses de la
 * ventana. La ventana es la del filtro de fechas; sin filtro, los últimos 12 meses. Si el
 * desarrollo no tiene NINGUNA fecha de venta registrada, la absorción es `null` («-»): un 0
 * diría «no se vendió nada», y lo cierto es «no se sabe cuándo se vendió». Medido el
 * 2026-10-15: ninguna unidad del Hub tiene `sold_at`, así que hoy la columna sale vacía.
 *
 * Sin alcance por rol ni marca: es inventario, sin contactos ni negocios de por medio.
 * Con filtro de plaza, los desarrollos sin plaza en el Hub no aparecen.
 */
export async function getAbsorptionReport(
  filters: ReportFilters = {}
): Promise<AbsorptionReportRow[]> {
  await usuarioDeReportes();

  const fechas = rangoDeFechas(filters.dateFrom, filters.dateTo);
  const antesDe = fechas?.lt ?? new Date();
  const desde = fechas?.gte ?? new Date(antesDe.getTime() - 365 * DIA_MS);
  const meses = (antesDe.getTime() - desde.getTime()) / DIA_MS / DIAS_POR_MES;

  const { data, error } = await inventarioParaReporte({
    plazas: filters.plaza ? plazaEnElHub(filters.plaza) : null,
    developmentId: filters.developmentId ?? null,
    vendidasDesde: desde,
    vendidasAntesDe: antesDe,
  });
  // Un fallo del Hub no se disfraza de «sin datos».
  if (error) throw new Error(error);

  return data.map((d) => ({
    developmentId: d.id,
    developmentName: d.name,
    plaza: etiquetaDePlaza(d.plaza),
    totalUnits: d.totalUnits,
    publishedUnits: d.publishedUnits,
    availableUnits: d.availableUnits,
    reservedUnits: d.reservedUnits,
    soldUnits: d.soldUnits,
    soldPct:
      d.publishedUnits > 0 ? Math.round((d.soldUnits / d.publishedUnits) * 1000) / 10 : null,
    absorptionRate:
      d.soldWithDate > 0 && meses > 0 ? Math.round((d.soldInWindow / meses) * 10) / 10 : null,
    avgPrice: d.avgPriceMxn === null ? null : Math.round(d.avgPriceMxn),
  }));
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
  const user = await usuarioDeReportes();

  const where: Prisma.DealWhereInput = {
    deletedAt: null,
    stage: "WON",
    commissionAdvisor: { not: null },
  };

  const fechas = rangoDeFechas(filters.dateFrom, filters.dateTo);
  if (fechas) where.actualCloseDate = fechas;
  if (filters.status) {
    where.commissionStatus = filters.status as any;
  }
  const acotado = (await alcance(user)).commission;
  if (acotado) where.AND = acotado;

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
  const user = await usuarioDeReportes();

  const where: Prisma.ActivityWhereInput = { deletedAt: null };

  const fechas = rangoDeFechas(filters.dateFrom, filters.dateTo);
  if (fechas) where.createdAt = fechas;
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
  // La actividad no tiene marca: cuenta si se ve su contacto (o su negocio, si no tiene contacto).
  const acotado = (await alcance(user)).activity;
  if (acotado) where.AND = acotado;

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
  const user = await usuarioDeReportes();

  const contactWhere: Prisma.ContactWhereInput = { deletedAt: null };
  const fechas = rangoDeFechas(filters.dateFrom, filters.dateTo);
  if (fechas) contactWhere.createdAt = fechas;
  // Contactos y negocios con el mismo alcance (rol y marca): si no, la conversión mezclaría
  // contactos de lo propio con negocios de todos.
  const acotado = await alcance(user);
  if (acotado.contact) contactWhere.AND = acotado.contact;

  // Agrupar contactos por fuente
  const contactsBySource = await prisma.contact.groupBy({
    by: ["leadSource"],
    // Los provisionales que nunca contestaron no son leads captados.
    where: realLeadWhere(contactWhere),
    _count: { id: true },
  });

  const results: LeadSourcesReportRow[] = [];

  for (const group of contactsBySource) {
    // Deals creados a partir de contactos de esta fuente
    const dealWhere: Prisma.DealWhereInput = {
      deletedAt: null,
      leadSourceAtDeal: group.leadSource,
    };
    if (fechas) dealWhere.createdAt = fechas;
    if (acotado.deal) dealWhere.AND = acotado.deal;

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
  const user = await usuarioDeReportes();

  const where: Prisma.DealWhereInput = {
    deletedAt: null,
    stage: { notIn: ["WON", "LOST", "FROZEN"] },
  };

  if (filters.plaza) {
    where.assignedTo = { plaza: filters.plaza as any };
  }
  if (filters.advisorId) where.assignedToId = filters.advisorId;
  const acotado = (await alcance(user)).deal;
  if (acotado) where.AND = acotado;

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
  const user = await usuarioDeReportes();

  const where: Prisma.DealWhereInput = {
    deletedAt: null,
    stage: "LOST",
    lostReason: { not: null },
  };

  const fechas = rangoDeFechas(filters.dateFrom, filters.dateTo);
  if (fechas) where.updatedAt = fechas;
  if (filters.plaza) {
    where.assignedTo = { plaza: filters.plaza as any };
  }
  if (filters.advisorId) where.assignedToId = filters.advisorId;
  const acotado = (await alcance(user)).deal;
  if (acotado) where.AND = acotado;

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
