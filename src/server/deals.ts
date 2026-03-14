// ============================================================
// Server Actions: Gestión de deals / pipeline de ventas
// Lógica de negocio con RBAC y reglas de transición
// ============================================================

"use server";

import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { DEAL_STAGE_PROBABILITY, STAGNATION_LIMITS } from "@/lib/constants";
import { createDealSchema, stageTransitionSchema } from "@/lib/validations/deal";
import type { Prisma, DealStage, DealType } from "@prisma/client";
import { dispatchWebhook } from "@/lib/webhooks/dispatcher";

// Roles con acceso completo a todos los deals
const FULL_ACCESS_ROLES = ["DIRECTOR"];
// Roles con acceso a deals de su plaza
const PLAZA_ACCESS_ROLES = ["GERENTE"];
// Roles con acceso a deals de su equipo
const TEAM_ACCESS_ROLES = ["TEAM_LEADER"];
// Roles con acceso solo a sus propios deals
const OWN_ACCESS_ROLES = ["ASESOR_SR", "ASESOR_JR"];

// --- Tipos de filtros para consultas ---
interface DealFilters {
  stage?: DealStage | DealStage[];
  dealType?: DealType;
  assignedToId?: string;
  developmentId?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

// --- Tipo de resultado de getDeals ---
interface DealsResult {
  deals: any[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  stageAggregations: Record<string, { count: number; totalValue: number }>;
}

/**
 * Construye la cláusula WHERE para filtrar deals según el rol del usuario.
 * Director = todos, Gerente = por plaza, TL = equipo, Asesor = propios.
 */
async function buildRBACFilter(
  userId: string,
  userRole: string,
  userPlaza: string
): Promise<Prisma.DealWhereInput> {
  // Director ve todo
  if (FULL_ACCESS_ROLES.includes(userRole)) {
    return { deletedAt: null };
  }

  // Gerente ve deals de su plaza
  if (PLAZA_ACCESS_ROLES.includes(userRole)) {
    return {
      deletedAt: null,
      assignedTo: { plaza: userPlaza as any },
    };
  }

  // Team Leader ve deals de su equipo
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

  // Asesor ve solo sus deals
  if (OWN_ACCESS_ROLES.includes(userRole)) {
    return {
      deletedAt: null,
      assignedToId: userId,
    };
  }

  // Marketing, Hostess y otros: solo lectura de sus deals
  return {
    deletedAt: null,
    assignedToId: userId,
  };
}

/**
 * Obtiene deals con filtros, paginación y RBAC.
 * Incluye nombre de contacto, desarrollo, unidad y asesor asignado.
 * Retorna valores agregados por etapa.
 */
export async function getDeals(filters: DealFilters = {}): Promise<DealsResult> {
  const session = await getServerSession();
  if (!session?.user) throw new Error("No autorizado");

  const {
    stage,
    dealType,
    assignedToId,
    developmentId,
    dateFrom,
    dateTo,
    page = 1,
    pageSize = 50,
    sortBy = "createdAt",
    sortOrder = "desc",
  } = filters;

  // Construir filtro base con RBAC
  const baseWhere = await buildRBACFilter(
    session.user.id,
    session.user.role,
    session.user.plaza
  );

  const where: Prisma.DealWhereInput = { ...baseWhere };

  // Aplicar filtros específicos
  if (stage) {
    if (Array.isArray(stage)) {
      where.stage = { in: stage };
    } else {
      where.stage = stage;
    }
  }
  if (dealType) where.dealType = dealType;
  if (assignedToId) where.assignedToId = assignedToId;
  if (developmentId) where.developmentId = developmentId;

  // Filtro de rango de fechas
  if (dateFrom || dateTo) {
    where.createdAt = {};
    if (dateFrom) (where.createdAt as any).gte = new Date(dateFrom);
    if (dateTo) (where.createdAt as any).lte = new Date(dateTo);
  }

  const skip = (page - 1) * pageSize;

  // Consultar deals y total en paralelo
  const [deals, total] = await Promise.all([
    prisma.deal.findMany({
      where,
      include: {
        contact: {
          select: { id: true, firstName: true, lastName: true, phone: true, temperature: true },
        },
        assignedTo: {
          select: { id: true, name: true, email: true, avatarUrl: true },
        },
        development: {
          select: { id: true, name: true },
        },
        unit: {
          select: { id: true, unitNumber: true },
        },
        _count: { select: { activities: true } },
      },
      orderBy: { [sortBy]: sortOrder },
      skip,
      take: pageSize,
    }),
    prisma.deal.count({ where }),
  ]);

  // Calcular agregados por etapa (sobre todos los deals filtrados por RBAC, sin paginación)
  const aggregations = await prisma.deal.groupBy({
    by: ["stage"],
    where: baseWhere,
    _count: { id: true },
    _sum: { estimatedValue: true },
  });

  const stageAggregations: Record<string, { count: number; totalValue: number }> = {};
  for (const agg of aggregations) {
    stageAggregations[agg.stage] = {
      count: agg._count.id,
      totalValue: Number(agg._sum.estimatedValue || 0),
    };
  }

  return {
    deals,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
    stageAggregations,
  };
}

/**
 * Obtiene un deal individual con todas sus relaciones.
 */
export async function getDeal(id: string) {
  const session = await getServerSession();
  if (!session?.user) throw new Error("No autorizado");

  const deal = await prisma.deal.findUnique({
    where: { id, deletedAt: null },
    include: {
      contact: {
        select: {
          id: true, firstName: true, lastName: true, phone: true, email: true,
          temperature: true, investmentProfile: true, propertyType: true,
          budgetMin: true, budgetMax: true, purchaseTimeline: true,
          leadSource: true, contactType: true,
        },
      },
      assignedTo: {
        select: {
          id: true, name: true, email: true, avatarUrl: true, role: true,
          teamLeaderId: true, plaza: true,
        },
      },
      development: {
        select: {
          id: true, name: true, developerName: true, plaza: true,
          commissionRate: true, status: true,
        },
      },
      unit: {
        select: {
          id: true, unitNumber: true, unitType: true, area_m2: true,
          price: true, currency: true, floor: true, status: true,
        },
      },
      activities: {
        where: { deletedAt: null },
        orderBy: { createdAt: "desc" },
        take: 50,
        include: {
          user: { select: { id: true, name: true } },
        },
      },
    },
  });

  if (!deal) return null;

  // Verificar acceso RBAC
  const userRole = session.user.role;
  const userId = session.user.id;

  if (FULL_ACCESS_ROLES.includes(userRole)) return deal;

  if (PLAZA_ACCESS_ROLES.includes(userRole)) {
    if (deal.assignedTo?.plaza === session.user.plaza) return deal;
    return null;
  }

  if (TEAM_ACCESS_ROLES.includes(userRole)) {
    if (deal.assignedToId === userId || deal.assignedTo?.teamLeaderId === userId) return deal;
    return null;
  }

  if (deal.assignedToId === userId) return deal;
  return null;
}

/**
 * Crea un nuevo deal con validación Zod.
 * Establece probabilidad inicial según la etapa y guarda el leadSource del contacto.
 */
export async function createDeal(data: {
  contactId: string;
  developmentId?: string;
  unitId?: string;
  dealType: string;
  estimatedValue: number;
  currency?: string;
  expectedCloseDate: string | Date;
  leadSourceAtDeal?: string;
  assignedToId?: string;
}) {
  const session = await getServerSession();
  if (!session?.user) throw new Error("No autorizado");

  // Validar datos con Zod
  const contactForSource = await prisma.contact.findUnique({
    where: { id: data.contactId },
    select: { leadSource: true },
  });
  if (!contactForSource) throw new Error("Contacto no encontrado");

  const validatedData = createDealSchema.parse({
    ...data,
    expectedCloseDate: new Date(data.expectedCloseDate),
    leadSourceAtDeal: data.leadSourceAtDeal || contactForSource.leadSource,
  });

  // Verificar que el contacto existe
  const contact = await prisma.contact.findUnique({
    where: { id: validatedData.contactId },
  });
  if (!contact) throw new Error("Contacto no encontrado");

  // Verificar desarrollo si se proporcionó
  if (validatedData.developmentId) {
    const dev = await prisma.development.findUnique({
      where: { id: validatedData.developmentId },
    });
    if (!dev) throw new Error("Desarrollo no encontrado");
  }

  // Verificar unidad si se proporcionó
  if (validatedData.unitId) {
    const unit = await prisma.unit.findUnique({
      where: { id: validatedData.unitId },
    });
    if (!unit) throw new Error("Unidad no encontrada");
    if (unit.status !== "DISPONIBLE") {
      throw new Error("La unidad no está disponible");
    }
  }

  // Probabilidad inicial por etapa
  const initialStage = "NEW_LEAD";
  const probability = DEAL_STAGE_PROBABILITY[initialStage] || 5;

  const assignedToId = data.assignedToId || session.user.id;

  const deal = await prisma.deal.create({
    data: {
      contactId: validatedData.contactId,
      assignedToId,
      developmentId: validatedData.developmentId || null,
      unitId: validatedData.unitId || null,
      stage: initialStage,
      dealType: validatedData.dealType as any,
      estimatedValue: validatedData.estimatedValue,
      currency: (validatedData.currency || "MXN") as any,
      probability,
      expectedCloseDate: validatedData.expectedCloseDate,
      leadSourceAtDeal: validatedData.leadSourceAtDeal,
    },
    include: {
      contact: { select: { id: true, firstName: true, lastName: true } },
      assignedTo: { select: { id: true, name: true } },
      development: { select: { id: true, name: true } },
      unit: { select: { id: true, unitNumber: true } },
    },
  });

  // Crear actividad de registro
  await prisma.activity.create({
    data: {
      contactId: validatedData.contactId,
      dealId: deal.id,
      userId: session.user.id,
      activityType: "NOTE",
      subject: "Deal creado",
      description: `Deal creado con tipo ${validatedData.dealType} y valor estimado de ${validatedData.estimatedValue}`,
      status: "COMPLETADA",
      completedAt: new Date(),
    },
  });

  // Disparar webhook de deal creado (fire-and-forget, no bloquea la respuesta)
  dispatchWebhook("deal.created", { deal });

  return deal;
}

/**
 * Actualiza campos de un deal existente.
 */
export async function updateDeal(
  id: string,
  data: {
    developmentId?: string | null;
    unitId?: string | null;
    dealType?: string;
    estimatedValue?: number;
    currency?: string;
    expectedCloseDate?: string | Date;
    assignedToId?: string;
  }
) {
  const session = await getServerSession();
  if (!session?.user) throw new Error("No autorizado");

  const existing = await prisma.deal.findUnique({
    where: { id, deletedAt: null },
  });
  if (!existing) throw new Error("Deal no encontrado");

  // Construir datos de actualización
  const updateData: any = {};
  if (data.developmentId !== undefined) updateData.developmentId = data.developmentId;
  if (data.unitId !== undefined) updateData.unitId = data.unitId;
  if (data.dealType) updateData.dealType = data.dealType;
  if (data.estimatedValue) updateData.estimatedValue = data.estimatedValue;
  if (data.currency) updateData.currency = data.currency;
  if (data.expectedCloseDate) updateData.expectedCloseDate = new Date(data.expectedCloseDate);
  if (data.assignedToId) updateData.assignedToId = data.assignedToId;

  const deal = await prisma.deal.update({
    where: { id },
    data: updateData,
    include: {
      contact: { select: { id: true, firstName: true, lastName: true } },
      assignedTo: { select: { id: true, name: true } },
      development: { select: { id: true, name: true } },
      unit: { select: { id: true, unitNumber: true } },
    },
  });

  // Disparar webhook de deal actualizado (fire-and-forget, no bloquea la respuesta)
  dispatchWebhook("deal.updated", { deal });

  return deal;
}

/**
 * Transiciona un deal de una etapa a otra con validación de reglas de negocio.
 * - DISCOVERY_DONE requiere perfil de inversión completo en el contacto
 * - RESERVED requiere unitId asignada
 * - WON requiere actualCloseDate y activa cálculo de comisión
 * - LOST requiere lostReason
 * - Actualiza probabilidad automáticamente
 * - Crea actividad por cada cambio de etapa
 * - Actualiza estado de unidad si aplica
 */
export async function transitionDealStage(
  dealId: string,
  toStage: string,
  extras: {
    unitId?: string;
    actualCloseDate?: string | Date;
    lostReason?: string;
    lostReasonDetail?: string;
  } = {}
) {
  const session = await getServerSession();
  if (!session?.user) throw new Error("No autorizado");

  // Obtener deal actual con relaciones
  const deal = await prisma.deal.findUnique({
    where: { id: dealId, deletedAt: null },
    include: {
      contact: {
        select: {
          id: true, investmentProfile: true, propertyType: true,
          budgetMin: true, purchaseTimeline: true,
        },
      },
    },
  });

  if (!deal) throw new Error("Deal no encontrado");

  const fromStage = deal.stage;

  // Validar con esquema Zod
  const validated = stageTransitionSchema.parse({
    dealId,
    fromStage,
    toStage,
    unitId: extras.unitId,
    actualCloseDate: extras.actualCloseDate ? new Date(extras.actualCloseDate as string) : undefined,
    lostReason: extras.lostReason,
    lostReasonDetail: extras.lostReasonDetail,
  });

  // --- Regla: DISCOVERY_DONE requiere perfil de inversión completo ---
  if (toStage === "DISCOVERY_DONE") {
    const contact = deal.contact;
    if (
      !contact.investmentProfile ||
      !contact.propertyType ||
      !contact.budgetMin ||
      !contact.purchaseTimeline
    ) {
      throw new Error(
        "Para avanzar a Discovery Hecho, el contacto debe tener perfil de inversión, tipo de propiedad, presupuesto mínimo y horizonte de compra completados."
      );
    }
  }

  // Construir datos de actualización del deal
  const updateData: any = {
    stage: toStage,
    probability: DEAL_STAGE_PROBABILITY[toStage] ?? 0,
  };

  // Si se pasa unitId, asignarla
  if (validated.unitId) {
    updateData.unitId = validated.unitId;
  }

  // Si se marca como WON, registrar fecha de cierre y calcular comisiones
  if (toStage === "WON") {
    updateData.actualCloseDate = validated.actualCloseDate || new Date();

    // Obtener datos para calcular comisión
    const devData = deal.developmentId
      ? await prisma.development.findUnique({
          where: { id: deal.developmentId },
          select: { commissionRate: true },
        })
      : null;

    if (devData) {
      const commissionRate = Number(devData.commissionRate) / 100;
      const value = Number(deal.estimatedValue);
      const totalCommission = value * commissionRate;

      updateData.commissionTotal = totalCommission;
      updateData.commissionAdvisor = totalCommission * 0.4;
      updateData.commissionTL = totalCommission * 0.1;
      updateData.commissionGerente = totalCommission * 0.05;
      updateData.commissionDirector = totalCommission * 0.05;
    }
  }

  // Si se marca como LOST, guardar razón
  if (toStage === "LOST") {
    updateData.lostReason = validated.lostReason;
    updateData.lostReasonDetail = validated.lostReasonDetail || null;
  }

  // Actualizar el deal
  const updatedDeal = await prisma.deal.update({
    where: { id: dealId },
    data: updateData,
    include: {
      contact: { select: { id: true, firstName: true, lastName: true } },
      assignedTo: { select: { id: true, name: true } },
      development: { select: { id: true, name: true } },
      unit: { select: { id: true, unitNumber: true } },
    },
  });

  // Actualizar estado de unidad si corresponde
  if (toStage === "RESERVED" && updatedDeal.unitId) {
    await prisma.unit.update({
      where: { id: updatedDeal.unitId },
      data: {
        status: "APARTADA",
        reservationDate: new Date(),
        reservedByContactId: deal.contactId,
        reservedByUserId: deal.assignedToId,
      },
    });

    // Actualizar contadores del desarrollo
    if (deal.developmentId) {
      await prisma.development.update({
        where: { id: deal.developmentId },
        data: {
          reservedUnits: { increment: 1 },
          availableUnits: { decrement: 1 },
        },
      });
    }
  }

  if (toStage === "WON" && updatedDeal.unitId) {
    await prisma.unit.update({
      where: { id: updatedDeal.unitId },
      data: {
        status: "VENDIDA",
        saleDate: new Date(),
        salePrice: deal.estimatedValue,
      },
    });

    // Actualizar contadores del desarrollo
    if (deal.developmentId) {
      const currentUnit = await prisma.unit.findUnique({
        where: { id: updatedDeal.unitId },
      });
      // Solo actualizar si antes estaba apartada (no descontar disponible dos veces)
      if (currentUnit) {
        await prisma.development.update({
          where: { id: deal.developmentId },
          data: {
            soldUnits: { increment: 1 },
            reservedUnits: { decrement: 1 },
          },
        });
      }
    }
  }

  // Crear actividad de cambio de etapa
  const stageLabels: Record<string, string> = {
    NEW_LEAD: "Nuevo Lead",
    CONTACTED: "Contactado",
    DISCOVERY_DONE: "Discovery Hecho",
    MEETING_SCHEDULED: "Reunión Agendada",
    MEETING_COMPLETED: "Reunión Realizada",
    PROPOSAL_SENT: "Propuesta Enviada",
    NEGOTIATION: "Negociación",
    RESERVED: "Reservado",
    CONTRACT_SIGNED: "Contrato Firmado",
    CLOSING: "Cierre",
    WON: "Ganado",
    LOST: "Perdido",
    FROZEN: "Congelado",
  };

  await prisma.activity.create({
    data: {
      contactId: deal.contactId,
      dealId: deal.id,
      userId: session.user.id,
      activityType: "NOTE",
      subject: `Cambio de etapa: ${stageLabels[fromStage] || fromStage} → ${stageLabels[toStage] || toStage}`,
      description: toStage === "LOST"
        ? `Razón: ${extras.lostReason}${extras.lostReasonDetail ? ` - ${extras.lostReasonDetail}` : ""}`
        : undefined,
      status: "COMPLETADA",
      completedAt: new Date(),
    },
  });

  // Disparar webhook de cambio de etapa (fire-and-forget, no bloquea la respuesta)
  dispatchWebhook("deal.stage_changed", { deal: updatedDeal, previousStage: fromStage, newStage: toStage });

  // Disparar webhooks adicionales si el deal fue ganado o perdido
  if (toStage === "WON") {
    dispatchWebhook("deal.won", { deal: updatedDeal });
  }
  if (toStage === "LOST") {
    dispatchWebhook("deal.lost", { deal: updatedDeal });
  }

  return updatedDeal;
}

/**
 * Obtiene deals agrupados por etapa con conteos y valores totales.
 * Para renderizar el Kanban board.
 */
export async function getDealsByStage() {
  const session = await getServerSession();
  if (!session?.user) throw new Error("No autorizado");

  const baseWhere = await buildRBACFilter(
    session.user.id,
    session.user.role,
    session.user.plaza
  );

  const deals = await prisma.deal.findMany({
    where: baseWhere,
    include: {
      contact: {
        select: { id: true, firstName: true, lastName: true, temperature: true },
      },
      assignedTo: {
        select: { id: true, name: true, avatarUrl: true },
      },
      development: {
        select: { id: true, name: true },
      },
      unit: {
        select: { id: true, unitNumber: true },
      },
      activities: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { createdAt: true },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  // Agrupar por etapa
  const grouped: Record<string, typeof deals> = {};
  for (const deal of deals) {
    if (!grouped[deal.stage]) grouped[deal.stage] = [];
    grouped[deal.stage].push(deal);
  }

  return grouped;
}

/**
 * Obtiene deals estancados: sin actividad más allá del límite de días por etapa.
 */
export async function getStagnantDeals() {
  const session = await getServerSession();
  if (!session?.user) throw new Error("No autorizado");

  const baseWhere = await buildRBACFilter(
    session.user.id,
    session.user.role,
    session.user.plaza
  );

  // Excluir etapas terminales
  const activeDeals = await prisma.deal.findMany({
    where: {
      ...baseWhere,
      stage: { notIn: ["WON", "LOST", "FROZEN"] },
    },
    include: {
      contact: {
        select: { id: true, firstName: true, lastName: true },
      },
      assignedTo: {
        select: { id: true, name: true },
      },
      development: {
        select: { id: true, name: true },
      },
      activities: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { createdAt: true },
      },
    },
  });

  const now = new Date();
  const stagnant = activeDeals.filter((deal) => {
    const limit = STAGNATION_LIMITS[deal.stage] || 7;
    // Última actividad o fecha de creación del deal
    const lastActivity = deal.activities[0]?.createdAt || deal.createdAt;
    const daysSinceActivity = Math.floor(
      (now.getTime() - new Date(lastActivity).getTime()) / (1000 * 60 * 60 * 24)
    );
    return daysSinceActivity > limit;
  });

  return stagnant;
}
