// ============================================================
// Server Actions: Actividades
// Lógica de negocio para gestionar actividades e interacciones
// ============================================================

import prisma from "@/lib/db"
import { getServerSession } from "@/lib/auth/session"
import { ActivityType, ActivityStatus, Prisma } from "@prisma/client"
import { dispatchWebhook } from "@/lib/webhooks/dispatcher"

// Roles con acceso total
const FULL_ACCESS_ROLES = ["ADMIN", "DIRECTOR", "GERENTE", "DEVELOPER_EXT", "MANTENIMIENTO"]
// Roles con acceso a su equipo
const TEAM_ACCESS_ROLES = ["ADMIN", "TEAM_LEADER"]
// Roles con acceso solo a lo propio
const OWN_ACCESS_ROLES = ["ASESOR", "ASESOR_SR", "ASESOR_JR", "BROKER", "HOSTESS"]

// Tipos de actividad que se registran como COMPLETADA por defecto
const AUTO_COMPLETED_TYPES: ActivityType[] = [
  "CALL_OUTBOUND",
  "CALL_INBOUND",
  "WHATSAPP_OUT",
  "WHATSAPP_IN",
  "EMAIL_SENT",
  "EMAIL_RECEIVED",
  "MEETING_VIRTUAL",
  "MEETING_PRESENTIAL",
  "MEETING_SHOWROOM",
  "DISCOVERY_CALL",
  "PROPOSAL_DELIVERY",
  "FOLLOW_UP",
  "WALK_IN",
  "NOTE",
  "CONTRACT_REVIEW",
  "CLOSING_ACTIVITY",
]

// Metas del acuerdo de actividad (valores por defecto)
const AGREEMENT_DEFAULTS = {
  dailyContacts: 15, // contactos salientes por día (llamadas + whatsapp + email)
  weeklyMeetings: 5, // reuniones agendadas por semana
  weeklyMeetingsCompleted: 3, // reuniones completadas por semana
  weeklyProposals: 2, // propuestas enviadas por semana
  weeklyDiscoveries: 3, // discovery calls por semana
  dailyFollowUps: 5, // seguimientos por día
}

// ============================================================
// Interfaces de filtros y respuestas
// ============================================================

export interface ActivityFilters {
  contactId?: string
  dealId?: string
  userId?: string
  type?: ActivityType
  status?: ActivityStatus
  dateFrom?: Date
  dateTo?: Date
  page?: number
  pageSize?: number
}

export interface ActivityStats {
  totalContacts: number // CALL_OUTBOUND + WHATSAPP_OUT + EMAIL_SENT
  totalMeetings: number // MEETING_VIRTUAL + MEETING_PRESENTIAL + MEETING_SHOWROOM
  totalDiscoveries: number
  totalProposals: number
  totalFollowUps: number
  totalTasks: number
  totalAll: number
}

export interface AgreementMetric {
  label: string
  current: number
  target: number
  percentage: number
  period: "daily" | "weekly"
}

export interface AgreementProgress {
  metrics: AgreementMetric[]
  overallPercentage: number
}

// ============================================================
// getActivities — listar actividades con filtros y RBAC
// ============================================================

export async function getActivities(filters: ActivityFilters = {}) {
  const session = await getServerSession()
  if (!session?.user) throw new Error("No autorizado")

  const {
    contactId,
    dealId,
    userId,
    type,
    status,
    dateFrom,
    dateTo,
    page = 1,
    pageSize = 20,
  } = filters

  const where: Prisma.ActivityWhereInput = { deletedAt: null }
  const userRole = session.user.role
  const currentUserId = session.user.id

  // RBAC: restringir según rol
  if (OWN_ACCESS_ROLES.includes(userRole)) {
    where.userId = currentUserId
  } else if (TEAM_ACCESS_ROLES.includes(userRole)) {
    const teamMembers = await prisma.user.findMany({
      where: { teamLeaderId: currentUserId },
      select: { id: true },
    })
    where.userId = { in: [currentUserId, ...teamMembers.map((m) => m.id)] }
  } else if (!FULL_ACCESS_ROLES.includes(userRole) && userRole !== "MARKETING") {
    throw new Error("Acceso denegado")
  }

  // Aplicar filtros específicos
  if (contactId) where.contactId = contactId
  if (dealId) where.dealId = dealId
  if (userId) where.userId = userId
  if (type) where.activityType = type
  if (status) where.status = status

  // Rango de fechas
  if (dateFrom || dateTo) {
    where.createdAt = {}
    if (dateFrom) (where.createdAt as Prisma.DateTimeFilter).gte = dateFrom
    if (dateTo) (where.createdAt as Prisma.DateTimeFilter).lte = dateTo
  }

  const skip = (page - 1) * pageSize

  const [activities, total] = await Promise.all([
    prisma.activity.findMany({
      where,
      include: {
        contact: { select: { id: true, firstName: true, lastName: true } },
        deal: { select: { id: true, stage: true, estimatedValue: true } },
        user: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
    }),
    prisma.activity.count({ where }),
  ])

  return {
    data: activities,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  }
}

// ============================================================
// createActivity — crear actividad con auto-status
// ============================================================

export interface CreateActivityInput {
  contactId: string
  dealId?: string
  activityType: ActivityType
  subject: string
  description?: string
  dueDate?: Date
  duration_minutes?: number
  outcome?: string
  status?: ActivityStatus
}

export async function createActivity(data: CreateActivityInput) {
  const session = await getServerSession()
  if (!session?.user) throw new Error("No autorizado")

  // Verificar que el contacto exista
  const contact = await prisma.contact.findUnique({
    where: { id: data.contactId, deletedAt: null },
  })
  if (!contact) throw new Error("Contacto no encontrado")

  // Si se proporciona dealId, verificar que existe
  if (data.dealId) {
    const deal = await prisma.deal.findUnique({
      where: { id: data.dealId, deletedAt: null },
    })
    if (!deal) throw new Error("Deal no encontrado")
  }

  // Auto-determinar status según tipo de actividad
  let autoStatus: ActivityStatus = "COMPLETADA"
  if (data.activityType === "TASK") {
    autoStatus = "PENDIENTE"
  }
  const finalStatus = data.status ?? autoStatus

  const activity = await prisma.activity.create({
    data: {
      contactId: data.contactId,
      dealId: data.dealId ?? null,
      userId: session.user.id,
      activityType: data.activityType,
      subject: data.subject,
      description: data.description ?? null,
      dueDate: data.dueDate ?? null,
      status: finalStatus,
      outcome: data.outcome ?? null,
      duration_minutes: data.duration_minutes ?? null,
      completedAt: finalStatus === "COMPLETADA" ? new Date() : null,
    },
    include: {
      contact: { select: { id: true, firstName: true, lastName: true } },
      deal: { select: { id: true, stage: true } },
      user: { select: { id: true, name: true } },
    },
  })

  // Disparar webhook de actividad creada (fire-and-forget, no bloquea la respuesta)
  dispatchWebhook("activity.created", { activity })

  return activity
}

// ============================================================
// updateActivity — actualizar (completar tarea, reprogramar, etc.)
// ============================================================

export interface UpdateActivityInput {
  subject?: string
  description?: string
  dueDate?: Date | null
  status?: ActivityStatus
  outcome?: string
  duration_minutes?: number
}

export async function updateActivity(id: string, data: UpdateActivityInput) {
  const session = await getServerSession()
  if (!session?.user) throw new Error("No autorizado")

  // Verificar que la actividad exista
  const existing = await prisma.activity.findUnique({
    where: { id, deletedAt: null },
  })
  if (!existing) throw new Error("Actividad no encontrada")

  // RBAC: solo el dueño, su líder o roles superiores pueden editar
  const userRole = session.user.role
  const currentUserId = session.user.id
  if (OWN_ACCESS_ROLES.includes(userRole) && existing.userId !== currentUserId) {
    throw new Error("No tienes permiso para editar esta actividad")
  }

  // Si se está completando, registrar fecha de completado
  const updateData: Prisma.ActivityUpdateInput = {}
  if (data.subject !== undefined) updateData.subject = data.subject
  if (data.description !== undefined) updateData.description = data.description
  if (data.dueDate !== undefined) updateData.dueDate = data.dueDate
  if (data.outcome !== undefined) updateData.outcome = data.outcome
  if (data.duration_minutes !== undefined) updateData.duration_minutes = data.duration_minutes
  if (data.status !== undefined) {
    updateData.status = data.status
    if (data.status === "COMPLETADA") {
      updateData.completedAt = new Date()
    }
  }

  const activity = await prisma.activity.update({
    where: { id },
    data: updateData,
    include: {
      contact: { select: { id: true, firstName: true, lastName: true } },
      deal: { select: { id: true, stage: true } },
      user: { select: { id: true, name: true } },
    },
  })

  return activity
}

// ============================================================
// getActivityStats — conteo por tipo para KPI tracking
// ============================================================

export async function getActivityStats(
  userId: string,
  dateFrom: Date,
  dateTo: Date
): Promise<ActivityStats> {
  const session = await getServerSession()
  if (!session?.user) throw new Error("No autorizado")

  const where: Prisma.ActivityWhereInput = {
    userId,
    deletedAt: null,
    createdAt: { gte: dateFrom, lte: dateTo },
  }

  // Contar por tipos agrupados
  const [contacts, meetings, discoveries, proposals, followUps, tasks, total] =
    await Promise.all([
      // Contactos salientes: llamadas + whatsapp + email
      prisma.activity.count({
        where: {
          ...where,
          activityType: { in: ["CALL_OUTBOUND", "WHATSAPP_OUT", "EMAIL_SENT"] },
        },
      }),
      // Reuniones: virtual + presencial + showroom
      prisma.activity.count({
        where: {
          ...where,
          activityType: { in: ["MEETING_VIRTUAL", "MEETING_PRESENTIAL", "MEETING_SHOWROOM"] },
        },
      }),
      // Discovery calls
      prisma.activity.count({
        where: { ...where, activityType: "DISCOVERY_CALL" },
      }),
      // Propuestas
      prisma.activity.count({
        where: { ...where, activityType: "PROPOSAL_DELIVERY" },
      }),
      // Seguimientos
      prisma.activity.count({
        where: { ...where, activityType: "FOLLOW_UP" },
      }),
      // Tareas
      prisma.activity.count({
        where: { ...where, activityType: "TASK" },
      }),
      // Total
      prisma.activity.count({ where }),
    ])

  return {
    totalContacts: contacts,
    totalMeetings: meetings,
    totalDiscoveries: discoveries,
    totalProposals: proposals,
    totalFollowUps: followUps,
    totalTasks: tasks,
    totalAll: total,
  }
}

// ============================================================
// getOverdueTasks — tareas vencidas (dueDate < now, PENDIENTE)
// ============================================================

export async function getOverdueTasks(userId?: string) {
  const session = await getServerSession()
  if (!session?.user) throw new Error("No autorizado")

  const where: Prisma.ActivityWhereInput = {
    activityType: "TASK",
    status: "PENDIENTE",
    dueDate: { lt: new Date() },
    deletedAt: null,
  }

  // RBAC: restringir según rol
  const userRole = session.user.role
  const currentUserId = session.user.id

  if (userId) {
    where.userId = userId
  } else if (OWN_ACCESS_ROLES.includes(userRole)) {
    where.userId = currentUserId
  } else if (TEAM_ACCESS_ROLES.includes(userRole)) {
    const teamMembers = await prisma.user.findMany({
      where: { teamLeaderId: currentUserId },
      select: { id: true },
    })
    where.userId = { in: [currentUserId, ...teamMembers.map((m) => m.id)] }
  }
  // FULL_ACCESS_ROLES ven todas

  const tasks = await prisma.activity.findMany({
    where,
    include: {
      contact: { select: { id: true, firstName: true, lastName: true } },
      user: { select: { id: true, name: true } },
    },
    orderBy: { dueDate: "asc" },
    take: 50,
  })

  return tasks
}

// ============================================================
// getActivityAgreementProgress — progreso vs metas del acuerdo
// ============================================================

export async function getActivityAgreementProgress(
  userId: string,
  weekStart: Date
): Promise<AgreementProgress> {
  const session = await getServerSession()
  if (!session?.user) throw new Error("No autorizado")

  const today = new Date()
  const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const dayEnd = new Date(dayStart)
  dayEnd.setDate(dayEnd.getDate() + 1)

  // Fin de la semana (domingo)
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekEnd.getDate() + 7)

  const baseWhere: Prisma.ActivityWhereInput = {
    userId,
    deletedAt: null,
  }

  // Métricas diarias
  const [dailyContacts, dailyFollowUps] = await Promise.all([
    // Contactos salientes hoy
    prisma.activity.count({
      where: {
        ...baseWhere,
        activityType: { in: ["CALL_OUTBOUND", "WHATSAPP_OUT", "EMAIL_SENT"] },
        createdAt: { gte: dayStart, lt: dayEnd },
      },
    }),
    // Seguimientos hoy
    prisma.activity.count({
      where: {
        ...baseWhere,
        activityType: "FOLLOW_UP",
        createdAt: { gte: dayStart, lt: dayEnd },
      },
    }),
  ])

  // Métricas semanales
  const [weeklyMeetings, weeklyMeetingsCompleted, weeklyProposals, weeklyDiscoveries] =
    await Promise.all([
      // Reuniones agendadas esta semana
      prisma.activity.count({
        where: {
          ...baseWhere,
          activityType: { in: ["MEETING_VIRTUAL", "MEETING_PRESENTIAL", "MEETING_SHOWROOM"] },
          createdAt: { gte: weekStart, lt: weekEnd },
        },
      }),
      // Reuniones completadas esta semana
      prisma.activity.count({
        where: {
          ...baseWhere,
          activityType: { in: ["MEETING_VIRTUAL", "MEETING_PRESENTIAL", "MEETING_SHOWROOM"] },
          status: "COMPLETADA",
          createdAt: { gte: weekStart, lt: weekEnd },
        },
      }),
      // Propuestas esta semana
      prisma.activity.count({
        where: {
          ...baseWhere,
          activityType: "PROPOSAL_DELIVERY",
          createdAt: { gte: weekStart, lt: weekEnd },
        },
      }),
      // Discovery calls esta semana
      prisma.activity.count({
        where: {
          ...baseWhere,
          activityType: "DISCOVERY_CALL",
          createdAt: { gte: weekStart, lt: weekEnd },
        },
      }),
    ])

  // Construir métricas con porcentaje
  const metrics: AgreementMetric[] = [
    {
      label: "Contactos salientes",
      current: dailyContacts,
      target: AGREEMENT_DEFAULTS.dailyContacts,
      percentage: Math.round((dailyContacts / AGREEMENT_DEFAULTS.dailyContacts) * 100),
      period: "daily",
    },
    {
      label: "Seguimientos",
      current: dailyFollowUps,
      target: AGREEMENT_DEFAULTS.dailyFollowUps,
      percentage: Math.round((dailyFollowUps / AGREEMENT_DEFAULTS.dailyFollowUps) * 100),
      period: "daily",
    },
    {
      label: "Reuniones agendadas",
      current: weeklyMeetings,
      target: AGREEMENT_DEFAULTS.weeklyMeetings,
      percentage: Math.round((weeklyMeetings / AGREEMENT_DEFAULTS.weeklyMeetings) * 100),
      period: "weekly",
    },
    {
      label: "Reuniones completadas",
      current: weeklyMeetingsCompleted,
      target: AGREEMENT_DEFAULTS.weeklyMeetingsCompleted,
      percentage: Math.round(
        (weeklyMeetingsCompleted / AGREEMENT_DEFAULTS.weeklyMeetingsCompleted) * 100
      ),
      period: "weekly",
    },
    {
      label: "Propuestas enviadas",
      current: weeklyProposals,
      target: AGREEMENT_DEFAULTS.weeklyProposals,
      percentage: Math.round((weeklyProposals / AGREEMENT_DEFAULTS.weeklyProposals) * 100),
      period: "weekly",
    },
    {
      label: "Discovery calls",
      current: weeklyDiscoveries,
      target: AGREEMENT_DEFAULTS.weeklyDiscoveries,
      percentage: Math.round((weeklyDiscoveries / AGREEMENT_DEFAULTS.weeklyDiscoveries) * 100),
      period: "weekly",
    },
  ]

  // Porcentaje general promediando todas las métricas
  const overallPercentage = Math.round(
    metrics.reduce((sum, m) => sum + Math.min(m.percentage, 100), 0) / metrics.length
  )

  return { metrics, overallPercentage }
}
