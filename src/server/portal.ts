// ============================================================
// Server Actions: Portal externo para desarrolladores (DEVELOPER_EXT)
// Solo expone datos agregados — NO revela información de contactos
// ============================================================

"use server";

import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { PIPELINE_STAGES } from "@/lib/constants";

// Etapas cerradas que no cuentan para pipeline activo
const CLOSED_STAGES = ["WON", "LOST", "FROZEN"];

// Tipos de actividad agrupados para resumen
const MEETING_TYPES = [
  "MEETING_VIRTUAL",
  "MEETING_PRESENTIAL",
  "MEETING_SHOWROOM",
];
const PROPOSAL_TYPES = ["PROPOSAL_DELIVERY"];
const VISIT_TYPES = ["WALK_IN"];

/**
 * Valida que el usuario actual tenga rol DEVELOPER_EXT.
 * Lanza error si no está autenticado o no tiene el rol correcto.
 */
async function validatePortalAccess() {
  const session = await getServerSession();
  if (!session?.user) throw new Error("No autorizado");
  if (session.user.role !== "DEVELOPER_EXT") {
    throw new Error("Acceso restringido a desarrolladores externos");
  }
  return session.user;
}

/**
 * Dashboard principal del portal de desarrollador.
 * Retorna todos los desarrollos MASTERBROKER con métricas agregadas.
 * NO expone datos de contactos individuales.
 */
export async function getPortalDashboard(userId: string) {
  const user = await validatePortalAccess();

  // Por ahora retornamos todos los desarrollos MASTERBROKER activos
  // (el usuario demo tiene acceso a todos)
  const developments = await prisma.development.findMany({
    where: {
      deletedAt: null,
      isActive: true,
      developmentType: "MASTERBROKER",
    },
    include: {
      units: {
        where: { deletedAt: null },
        select: { status: true },
      },
      deals: {
        where: { deletedAt: null },
        select: {
          id: true,
          stage: true,
          estimatedValue: true,
          probability: true,
          createdAt: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // Fecha hace 30 días para actividad reciente
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  // Construir resumen por desarrollo
  const summaries = developments.map((dev) => {
    // Conteo de unidades por estado
    const availableCount = dev.units.filter(
      (u) => u.status === "DISPONIBLE"
    ).length;
    const reservedCount = dev.units.filter(
      (u) => u.status === "APARTADA"
    ).length;
    const soldCount = dev.units.filter(
      (u) => u.status === "VENDIDA"
    ).length;

    // Deals activos (no cerrados)
    const activeDeals = dev.deals.filter(
      (d) => !CLOSED_STAGES.includes(d.stage)
    );

    // Valor ponderado del pipeline: suma(estimatedValue * probability / 100)
    const pipelineValue = activeDeals.reduce((sum, d) => {
      return sum + Number(d.estimatedValue) * (d.probability / 100);
    }, 0);

    // Tasa de absorción: unidades vendidas por mes desde la creación
    const monthsSinceCreation = Math.max(
      1,
      (Date.now() - dev.createdAt.getTime()) / (1000 * 60 * 60 * 24 * 30)
    );
    const absorptionRate = soldCount / monthsSinceCreation;

    // Actividad reciente (deals creados en últimos 30 días)
    const recentDealCount = dev.deals.filter(
      (d) => d.createdAt >= thirtyDaysAgo
    ).length;

    // Excluir arrays crudos del response
    const { units, deals, ...devInfo } = dev;

    return {
      ...devInfo,
      totalUnits: dev.totalUnits,
      availableCount,
      reservedCount,
      soldCount,
      activeDealsCount: activeDeals.length,
      pipelineValue: Math.round(pipelineValue),
      absorptionRate: Math.round(absorptionRate * 100) / 100,
      recentDealCount,
    };
  });

  return {
    userName: user.name,
    developments: summaries,
  };
}

/**
 * Detalle de un desarrollo específico para el portal.
 * Incluye unidades (SIN datos de contacto), pipeline por etapa
 * (SIN nombres), y tendencia mensual de ventas.
 */
export async function getPortalDevelopmentDetail(
  developmentId: string,
  userId: string
) {
  const user = await validatePortalAccess();

  // Obtener desarrollo con unidades y deals
  const development = await prisma.development.findUnique({
    where: { id: developmentId, deletedAt: null },
    include: {
      units: {
        where: { deletedAt: null },
        orderBy: { unitNumber: "asc" },
        select: {
          id: true,
          unitNumber: true,
          unitType: true,
          area_m2: true,
          price: true,
          currency: true,
          floor: true,
          status: true,
          // NO incluir reservedByContact ni reservedByUser (datos sensibles)
        },
      },
      deals: {
        where: { deletedAt: null },
        select: {
          id: true,
          stage: true,
          estimatedValue: true,
          probability: true,
          createdAt: true,
          // NO incluir contact (datos sensibles)
        },
      },
    },
  });

  if (!development) {
    throw new Error("Desarrollo no encontrado");
  }

  // Verificar que sea MASTERBROKER (accesible para desarrolladores)
  if (development.developmentType !== "MASTERBROKER") {
    throw new Error("No tienes acceso a este desarrollo");
  }

  // --- Resumen de unidades por estado ---
  const unitSummary = {
    total: development.units.length,
    disponible: development.units.filter((u) => u.status === "DISPONIBLE")
      .length,
    apartada: development.units.filter((u) => u.status === "APARTADA").length,
    vendida: development.units.filter((u) => u.status === "VENDIDA").length,
    noDisponible: development.units.filter(
      (u) => u.status === "NO_DISPONIBLE"
    ).length,
  };

  // --- Pipeline agrupado por etapa (solo conteo y valor, SIN contactos) ---
  const pipelineByStage = PIPELINE_STAGES.filter(
    (s) => !CLOSED_STAGES.includes(s.code)
  ).map((stage) => {
    const stageDeals = development.deals.filter(
      (d) => d.stage === stage.code
    );
    const totalValue = stageDeals.reduce(
      (sum, d) => sum + Number(d.estimatedValue),
      0
    );
    return {
      stage: stage.code,
      label: stage.label,
      count: stageDeals.length,
      totalValue: Math.round(totalValue),
    };
  }).filter((s) => s.count > 0); // Solo mostrar etapas con deals

  // --- Tendencia mensual de ventas (unidades vendidas por mes) ---
  // Usar los deals ganados para calcular ventas por mes
  const wonDeals = development.deals.filter((d) => d.stage === "WON");
  const monthlySalesMap = new Map<string, number>();

  wonDeals.forEach((deal) => {
    const key = `${deal.createdAt.getFullYear()}-${String(
      deal.createdAt.getMonth() + 1
    ).padStart(2, "0")}`;
    monthlySalesMap.set(key, (monthlySalesMap.get(key) || 0) + 1);
  });

  // Ordenar por fecha y tomar últimos 12 meses
  const monthlySales = Array.from(monthlySalesMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-12)
    .map(([month, count]) => ({ month, count }));

  // --- Tasa de absorción ---
  const monthsSinceCreation = Math.max(
    1,
    (Date.now() - development.createdAt.getTime()) /
      (1000 * 60 * 60 * 24 * 30)
  );
  const absorptionRate = unitSummary.vendida / monthsSinceCreation;

  // --- Valor total del pipeline activo ---
  const activeDeals = development.deals.filter(
    (d) => !CLOSED_STAGES.includes(d.stage)
  );
  const pipelineValue = activeDeals.reduce((sum, d) => {
    return sum + Number(d.estimatedValue) * (d.probability / 100);
  }, 0);

  // --- Resumen de actividad reciente (últimos 30 días) ---
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  // Contar actividades por tipo en los deals de este desarrollo
  const recentActivities = await prisma.activity.findMany({
    where: {
      deletedAt: null,
      createdAt: { gte: thirtyDaysAgo },
      deal: {
        developmentId: developmentId,
        deletedAt: null,
      },
    },
    select: {
      activityType: true,
    },
  });

  const meetingsCount = recentActivities.filter((a) =>
    MEETING_TYPES.includes(a.activityType)
  ).length;
  const proposalsCount = recentActivities.filter((a) =>
    PROPOSAL_TYPES.includes(a.activityType)
  ).length;
  const visitsCount = recentActivities.filter((a) =>
    VISIT_TYPES.includes(a.activityType)
  ).length;

  // Construir response sin datos sensibles
  const { units, deals, ...devInfo } = development;

  return {
    development: devInfo,
    units: units, // Solo campos seleccionados (sin contacto)
    unitSummary,
    pipelineByStage,
    monthlySales,
    absorptionRate: Math.round(absorptionRate * 100) / 100,
    pipelineValue: Math.round(pipelineValue),
    activitySummary: {
      meetings: meetingsCount,
      proposals: proposalsCount,
      visits: visitsCount,
    },
  };
}
