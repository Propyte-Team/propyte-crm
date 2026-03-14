// ============================================================
// Server Actions: Dashboard
// Obtener KPIs, pipeline, actividades y métricas por rol
// ============================================================

import prisma from "@/lib/db"
import { getServerSession } from "@/lib/auth/session"
import { DealStage, Prisma } from "@prisma/client"
import { PIPELINE_STAGES } from "@/lib/constants"
import { getActivityAgreementProgress, getOverdueTasks } from "./activities"

// Roles con acceso total a todas las plazas
const FULL_ACCESS_ROLES = ["DIRECTOR", "DEVELOPER_EXT"]

// ============================================================
// Interfaces de respuesta del dashboard
// ============================================================

export interface PipelineStageData {
  stage: string
  label: string
  count: number
  value: number
}

export interface RecentActivity {
  id: string
  activityType: string
  subject: string
  createdAt: Date
  contact: { firstName: string; lastName: string }
  user: { name: string }
}

export interface DashboardStats {
  // KPIs principales
  activeDeals: number
  activeDealsValue: number
  newLeadsMonth: number
  pendingCommissions: number
  conversionRate: number
  // Tendencias vs mes anterior
  activeDealsTrend: number
  newLeadsTrend: number
  pendingCommissionsTrend: number
  conversionRateTrend: number
  // Pipeline por etapa
  pipelineData: PipelineStageData[]
  // Actividades recientes
  recentActivities: RecentActivity[]
  // Tareas vencidas
  overdueTasksCount: number
  // Progreso de acuerdo de actividad (solo asesores)
  agreementProgress: {
    metrics: { label: string; current: number; target: number; percentage: number; period: string }[]
    overallPercentage: number
  } | null
  // Para gerentes/directores: métricas por asesor
  advisorStats?: AdvisorStat[]
  // Datos de tendencia mensual (últimos 6 meses)
  monthlyTrend: MonthlyTrendItem[]
}

export interface AdvisorStat {
  id: string
  name: string
  activeDeals: number
  totalValue: number
  activitiesThisWeek: number
  overdueTasksCount: number
}

export interface MonthlyTrendItem {
  month: string
  deals: number
  value: number
  won: number
}

// ============================================================
// getDashboardStats — obtener todos los KPIs según rol
// ============================================================

export async function getDashboardStats(
  userId: string,
  role: string,
  plaza?: string
): Promise<DashboardStats> {
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59)

  // Calcular inicio de la semana (lunes)
  const weekStart = new Date(now)
  const dayOfWeek = weekStart.getDay()
  const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1
  weekStart.setDate(weekStart.getDate() - diff)
  weekStart.setHours(0, 0, 0, 0)

  // Construir filtro base según rol
  const dealBaseWhere: Prisma.DealWhereInput = { deletedAt: null }

  if (role === "ASESOR_SR" || role === "ASESOR_JR" || role === "HOSTESS") {
    // Solo sus deals
    dealBaseWhere.assignedToId = userId
  } else if (role === "TEAM_LEADER") {
    // Deals de su equipo
    const teamMembers = await prisma.user.findMany({
      where: { teamLeaderId: userId },
      select: { id: true },
    })
    const teamIds = [userId, ...teamMembers.map((m) => m.id)]
    dealBaseWhere.assignedToId = { in: teamIds }
  } else if (role === "GERENTE") {
    // Deals de su plaza
    if (plaza) {
      dealBaseWhere.assignedTo = { plaza: plaza as any }
    }
  }
  // DIRECTOR y DEVELOPER_EXT ven todo

  // ---- KPIs del mes actual ----

  // Etapas activas (excluir WON, LOST, FROZEN)
  const activeStages: DealStage[] = [
    "NEW_LEAD", "CONTACTED", "DISCOVERY_DONE", "MEETING_SCHEDULED",
    "MEETING_COMPLETED", "PROPOSAL_SENT", "NEGOTIATION", "RESERVED",
    "CONTRACT_SIGNED", "CLOSING",
  ]

  const [
    activeDealsData,
    newLeadsCurrentMonth,
    newLeadsPrevMonth,
    pendingCommissionsResult,
    wonCurrentMonth,
    totalCurrentMonth,
    wonPrevMonth,
    totalPrevMonth,
    activeDealsLastMonth,
    pendingCommissionsPrevResult,
  ] = await Promise.all([
    // Deals activos con valor total
    prisma.deal.findMany({
      where: { ...dealBaseWhere, stage: { in: activeStages } },
      select: { estimatedValue: true, probability: true },
    }),
    // Leads nuevos este mes
    prisma.contact.count({
      where: {
        createdAt: { gte: monthStart },
        deletedAt: null,
        ...(dealBaseWhere.assignedToId
          ? { assignedToId: dealBaseWhere.assignedToId as string }
          : dealBaseWhere.assignedTo
          ? { assignedTo: dealBaseWhere.assignedTo as any }
          : {}),
      },
    }),
    // Leads nuevos mes anterior (para tendencia)
    prisma.contact.count({
      where: {
        createdAt: { gte: prevMonthStart, lte: prevMonthEnd },
        deletedAt: null,
        ...(dealBaseWhere.assignedToId
          ? { assignedToId: dealBaseWhere.assignedToId as string }
          : dealBaseWhere.assignedTo
          ? { assignedTo: dealBaseWhere.assignedTo as any }
          : {}),
      },
    }),
    // Comisiones pendientes
    prisma.deal.aggregate({
      where: { ...dealBaseWhere, commissionStatus: "PENDIENTE", stage: "WON" },
      _sum: { commissionTotal: true },
    }),
    // Deals ganados este mes
    prisma.deal.count({
      where: { ...dealBaseWhere, stage: "WON", actualCloseDate: { gte: monthStart } },
    }),
    // Total deals creados este mes
    prisma.deal.count({
      where: { ...dealBaseWhere, createdAt: { gte: monthStart } },
    }),
    // Deals ganados mes anterior
    prisma.deal.count({
      where: {
        ...dealBaseWhere,
        stage: "WON",
        actualCloseDate: { gte: prevMonthStart, lte: prevMonthEnd },
      },
    }),
    // Total deals creados mes anterior
    prisma.deal.count({
      where: { ...dealBaseWhere, createdAt: { gte: prevMonthStart, lte: prevMonthEnd } },
    }),
    // Deals activos mes anterior (para tendencia)
    prisma.deal.count({
      where: {
        ...dealBaseWhere,
        stage: { in: activeStages },
        createdAt: { lte: prevMonthEnd },
      },
    }),
    // Comisiones pendientes mes anterior
    prisma.deal.aggregate({
      where: {
        ...dealBaseWhere,
        commissionStatus: "PENDIENTE",
        stage: "WON",
        actualCloseDate: { lte: prevMonthEnd },
      },
      _sum: { commissionTotal: true },
    }),
  ])

  // Calcular valores
  const activeDeals = activeDealsData.length
  const activeDealsValue = activeDealsData.reduce(
    (sum, d) => sum + Number(d.estimatedValue) * (d.probability / 100),
    0
  )
  const pendingCommissions = Number(pendingCommissionsResult._sum.commissionTotal ?? 0)
  const conversionRate = totalCurrentMonth > 0
    ? Math.round((wonCurrentMonth / totalCurrentMonth) * 1000) / 10
    : 0
  const prevConversionRate = totalPrevMonth > 0
    ? Math.round((wonPrevMonth / totalPrevMonth) * 1000) / 10
    : 0

  // Tendencias (porcentaje de cambio)
  const calcTrend = (current: number, previous: number) => {
    if (previous === 0) return current > 0 ? 100 : 0
    return Math.round(((current - previous) / previous) * 100)
  }

  const activeDealsTrend = calcTrend(activeDeals, activeDealsLastMonth)
  const newLeadsTrend = calcTrend(newLeadsCurrentMonth, newLeadsPrevMonth)
  const prevPendingComm = Number(pendingCommissionsPrevResult._sum.commissionTotal ?? 0)
  const pendingCommissionsTrend = calcTrend(pendingCommissions, prevPendingComm)
  const conversionRateTrend = Math.round((conversionRate - prevConversionRate) * 10) / 10

  // ---- Pipeline por etapa ----
  const pipelineRaw = await prisma.deal.groupBy({
    by: ["stage"],
    where: { ...dealBaseWhere, stage: { in: activeStages } },
    _count: { id: true },
    _sum: { estimatedValue: true },
  })

  const pipelineData: PipelineStageData[] = PIPELINE_STAGES
    .filter((s) => activeStages.includes(s.code as DealStage))
    .map((stage) => {
      const found = pipelineRaw.find((r) => r.stage === stage.code)
      return {
        stage: stage.code,
        label: stage.label,
        count: found?._count.id ?? 0,
        value: Number(found?._sum.estimatedValue ?? 0),
      }
    })

  // ---- Actividades recientes (últimas 10) ----
  const activityWhere: Prisma.ActivityWhereInput = { deletedAt: null }

  if (role === "ASESOR_SR" || role === "ASESOR_JR" || role === "HOSTESS") {
    activityWhere.userId = userId
  } else if (role === "TEAM_LEADER") {
    const teamMembers = await prisma.user.findMany({
      where: { teamLeaderId: userId },
      select: { id: true },
    })
    activityWhere.userId = { in: [userId, ...teamMembers.map((m) => m.id)] }
  } else if (role === "GERENTE" && plaza) {
    activityWhere.user = { plaza: plaza as any }
  }

  const recentActivities = await prisma.activity.findMany({
    where: activityWhere,
    include: {
      contact: { select: { firstName: true, lastName: true } },
      user: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  })

  // ---- Tareas vencidas ----
  const overdueTasks = await getOverdueTasks(
    role === "ASESOR_SR" || role === "ASESOR_JR" ? userId : undefined
  )

  // ---- Progreso de acuerdo de actividad (solo asesores) ----
  let agreementProgress = null
  if (["ASESOR_SR", "ASESOR_JR"].includes(role)) {
    agreementProgress = await getActivityAgreementProgress(userId, weekStart)
  }

  // ---- Estadísticas por asesor (para gerentes y directores) ----
  let advisorStats: AdvisorStat[] | undefined
  if (["GERENTE", "DIRECTOR", "TEAM_LEADER"].includes(role)) {
    const advisorWhere: Prisma.UserWhereInput = {
      isActive: true,
      role: { in: ["ASESOR_SR", "ASESOR_JR"] },
      deletedAt: null,
    }

    if (role === "TEAM_LEADER") {
      advisorWhere.teamLeaderId = userId
    } else if (role === "GERENTE" && plaza) {
      advisorWhere.plaza = plaza as any
    }

    const advisors = await prisma.user.findMany({
      where: advisorWhere,
      select: {
        id: true,
        name: true,
        _count: {
          select: {
            deals: { where: { stage: { in: activeStages }, deletedAt: null } },
          },
        },
        deals: {
          where: { stage: { in: activeStages }, deletedAt: null },
          select: { estimatedValue: true },
        },
        activities: {
          where: { createdAt: { gte: weekStart }, deletedAt: null },
          select: { id: true },
        },
      },
    })

    // Obtener tareas vencidas por asesor
    const overdueByAdvisor = await prisma.activity.groupBy({
      by: ["userId"],
      where: {
        activityType: "TASK",
        status: "PENDIENTE",
        dueDate: { lt: new Date() },
        deletedAt: null,
        userId: { in: advisors.map((a) => a.id) },
      },
      _count: { id: true },
    })

    advisorStats = advisors.map((advisor) => {
      const overdue = overdueByAdvisor.find((o) => o.userId === advisor.id)
      return {
        id: advisor.id,
        name: advisor.name,
        activeDeals: advisor._count.deals,
        totalValue: advisor.deals.reduce((sum, d) => sum + Number(d.estimatedValue), 0),
        activitiesThisWeek: advisor.activities.length,
        overdueTasksCount: overdue?._count.id ?? 0,
      }
    })
  }

  // ---- Tendencia mensual (últimos 6 meses) ----
  const monthlyTrend: MonthlyTrendItem[] = []
  const monthNames = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]

  for (let i = 5; i >= 0; i--) {
    const mStart = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const mEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59)

    const [dealsCount, wonCount, valueSum] = await Promise.all([
      prisma.deal.count({
        where: { ...dealBaseWhere, createdAt: { gte: mStart, lte: mEnd } },
      }),
      prisma.deal.count({
        where: { ...dealBaseWhere, stage: "WON", actualCloseDate: { gte: mStart, lte: mEnd } },
      }),
      prisma.deal.aggregate({
        where: { ...dealBaseWhere, stage: "WON", actualCloseDate: { gte: mStart, lte: mEnd } },
        _sum: { estimatedValue: true },
      }),
    ])

    monthlyTrend.push({
      month: `${monthNames[mStart.getMonth()]} ${mStart.getFullYear().toString().slice(-2)}`,
      deals: dealsCount,
      value: Number(valueSum._sum.estimatedValue ?? 0),
      won: wonCount,
    })
  }

  return {
    activeDeals,
    activeDealsValue,
    newLeadsMonth: newLeadsCurrentMonth,
    pendingCommissions,
    conversionRate,
    activeDealsTrend,
    newLeadsTrend,
    pendingCommissionsTrend,
    conversionRateTrend,
    pipelineData,
    recentActivities: recentActivities.map((a) => ({
      id: a.id,
      activityType: a.activityType,
      subject: a.subject,
      createdAt: a.createdAt,
      contact: { firstName: a.contact.firstName, lastName: a.contact.lastName },
      user: { name: a.user.name },
    })),
    overdueTasksCount: overdueTasks.length,
    agreementProgress,
    advisorStats,
    monthlyTrend,
  }
}
