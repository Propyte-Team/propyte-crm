// ============================================================
// API Route: /api/deals/[id]
// Operaciones sobre un deal específico
// GET   - Obtener detalle completo
// PATCH - Actualizar deal (incluye transiciones de etapa con reglas)
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { DEAL_STAGE_PROBABILITY } from "@/lib/constants";
import { dueDateSchema } from "@/lib/due-date";
import { dealCommissionFields } from "@/lib/commission-engine/for-deal";
import { withChangeSource } from "@/lib/audit/change-context";
import { aplicarInventarioDeEtapa } from "@/lib/deals/stage-inventory";
import { actividadDeCambioDeEtapa } from "@/lib/deals/stage-activity";

// Roles con acceso completo
const FULL_ACCESS_ROLES = ["ADMIN", "DIRECTOR"];
// Roles con acceso a su plaza
const PLAZA_ACCESS_ROLES = ["ADMIN", "GERENTE"];
// Roles con acceso a su equipo
const TEAM_ACCESS_ROLES = ["ADMIN", "TEAM_LEADER"];
// Roles con acceso solo a lo propio
const OWN_ACCESS_ROLES = ["ASESOR", "ASESOR_SR", "ASESOR_JR", "BROKER"];

// Orden de etapas para validar transiciones
const STAGE_ORDER = [
  "NEW_LEAD", "CONTACTED", "DISCOVERY_DONE", "MEETING_SCHEDULED",
  "MEETING_COMPLETED", "PROPOSAL_SENT", "NEGOTIATION", "RESERVED",
  "CONTRACT_SIGNED", "CLOSING", "WON",
] as const;

// Esquema de validación para actualizar deal
const updateDealSchema = z.object({
  stage: z.enum([
    "NEW_LEAD", "CONTACTED", "DISCOVERY_DONE", "MEETING_SCHEDULED",
    "MEETING_COMPLETED", "PROPOSAL_SENT", "NEGOTIATION", "RESERVED",
    "CONTRACT_SIGNED", "CLOSING", "WON", "LOST", "FROZEN",
  ]).optional(),
  dealType: z.enum(["NATIVA_CONTADO", "NATIVA_FINANCIAMIENTO", "MACROLOTE", "CORRETAJE", "MASTERBROKER"]).optional(),
  estimatedValue: z.number().positive().optional(),
  currency: z.enum(["MXN", "USD"]).optional(),
  probability: z.number().int().min(0).max(100).optional(),
  // Hora de pared de Cancún si el string no trae zona — ver src/lib/due-date.ts
  expectedCloseDate: dueDateSchema.optional(),
  developmentId: z.string().uuid().optional().nullable(),
  unitId: z.string().uuid().optional().nullable(),
  assignedToId: z.string().uuid().optional(),
  lostReason: z.enum([
    "PRECIO", "COMPETENCIA", "FINANCIAMIENTO_RECHAZADO", "NO_INTERESADO",
    "NO_CONTACTABLE", "COMPRO_DIRECTO", "DESARROLLO_CANCELADO", "OTRO",
  ]).optional(),
  lostReasonDetail: z.string().max(500).optional(),
  actualCloseDate: dueDateSchema.optional(),
});

/**
 * Verifica si el usuario tiene acceso al deal indicado según RBAC.
 */
async function verifyDealAccess(dealId: string, userId: string, userRole: string, userPlaza: string) {
  const deal = await prisma.deal.findUnique({
    where: { id: dealId, deletedAt: null },
    include: {
      contact: {
        select: {
          id: true, firstName: true, lastName: true, phone: true, email: true,
          temperature: true, investmentProfile: true, propertyType: true,
          budgetMin: true, purchaseTimeline: true, leadSource: true, contactType: true,
        },
      },
      assignedTo: {
        select: { id: true, name: true, email: true, role: true, teamLeaderId: true, plaza: true, avatarUrl: true },
      },
      development: {
        select: { id: true, name: true, plaza: true, developerName: true, commissionRate: true, status: true },
      },
      unit: {
        select: { id: true, unitNumber: true, unitType: true, price: true, status: true, area_m2: true, currency: true, floor: true },
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

  // Director ve todo
  if (FULL_ACCESS_ROLES.includes(userRole)) return deal;

  // Gerente ve su plaza
  if (PLAZA_ACCESS_ROLES.includes(userRole)) {
    if (deal.assignedTo?.plaza === userPlaza) return deal;
    return null;
  }

  // Team Leader ve su equipo
  if (TEAM_ACCESS_ROLES.includes(userRole)) {
    if (deal.assignedToId === userId || deal.assignedTo?.teamLeaderId === userId) return deal;
    return null;
  }

  // Asesor ve solo lo suyo
  if (OWN_ACCESS_ROLES.includes(userRole)) {
    if (deal.assignedToId === userId) return deal;
    return null;
  }

  // Marketing y otros: lectura limitada
  if (userRole === "MARKETING" || userRole === "DEVELOPER_EXT") return deal;

  return null;
}

/**
 * GET /api/deals/[id]
 * Obtiene detalle completo de un deal con todas sus relaciones.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const deal = await verifyDealAccess(params.id, session.user.id, session.user.role, session.user.plaza);

    if (!deal) {
      return NextResponse.json(
        { error: "Deal no encontrado o sin acceso" },
        { status: 404 }
      );
    }

    return NextResponse.json({ data: deal });
  } catch (error) {
    console.error("Error al obtener deal:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/deals/[id]
 * Actualiza un deal con validación de reglas de negocio para transiciones de etapa.
 * Reglas:
 * - DISCOVERY_DONE requiere perfil de inversión completo
 * - RESERVED requiere unitId
 * - WON requiere actualCloseDate y activa comisiones
 * - LOST requiere lostReason
 * - Probabilidad se actualiza automáticamente por etapa
 * - Crea actividad por cada cambio de etapa
 * - Actualiza estado de unidad si aplica
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    // Verificar acceso
    const existingDeal = await verifyDealAccess(params.id, session.user.id, session.user.role, session.user.plaza);
    if (!existingDeal) {
      return NextResponse.json(
        { error: "Deal no encontrado o sin acceso" },
        { status: 404 }
      );
    }

    // Verificar permisos de edición
    const userRole = session.user.role;
    const canEdit = [
      ...FULL_ACCESS_ROLES,
      ...PLAZA_ACCESS_ROLES,
      ...TEAM_ACCESS_ROLES,
      ...OWN_ACCESS_ROLES,
    ].includes(userRole);

    if (!canEdit) {
      return NextResponse.json(
        { error: "No tienes permiso para editar deals" },
        { status: 403 }
      );
    }

    // Parsear y validar body
    const body = await request.json();
    const validation = updateDealSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: "Datos inválidos", details: validation.error.flatten() },
        { status: 400 }
      );
    }

    const data = validation.data;

    // =============================================
    // Validaciones de reglas de negocio para transiciones de etapa
    // =============================================
    if (data.stage && data.stage !== existingDeal.stage) {
      const currentStage = existingDeal.stage;
      const newStage = data.stage;

      // Regla: No mover deal ya cerrado (excepto director)
      if (
        (currentStage === "WON" || currentStage === "LOST") &&
        !FULL_ACCESS_ROLES.includes(userRole)
      ) {
        return NextResponse.json(
          { error: "No se puede modificar un deal cerrado. Contacta a tu director." },
          { status: 400 }
        );
      }

      // Regla: FROZEN solo reactivable por TL+
      if (
        currentStage === "FROZEN" &&
        !FULL_ACCESS_ROLES.includes(userRole) &&
        !PLAZA_ACCESS_ROLES.includes(userRole) &&
        !TEAM_ACCESS_ROLES.includes(userRole)
      ) {
        return NextResponse.json(
          { error: "Solo un Team Leader o superior puede reactivar un deal congelado." },
          { status: 400 }
        );
      }

      // Regla: No retroceder más de una etapa
      if (newStage !== "LOST" && newStage !== "FROZEN") {
        const currentIdx = STAGE_ORDER.indexOf(currentStage as any);
        const newIdx = STAGE_ORDER.indexOf(newStage as any);

        if (currentIdx >= 0 && newIdx >= 0 && newIdx < currentIdx - 1) {
          return NextResponse.json(
            { error: "No se puede retroceder más de una etapa en el pipeline." },
            { status: 400 }
          );
        }
      }

      // Regla: DISCOVERY_DONE requiere perfil de inversión completo
      if (newStage === "DISCOVERY_DONE") {
        const contact = existingDeal.contact;
        if (
          !contact?.investmentProfile ||
          !contact?.propertyType ||
          !contact?.budgetMin ||
          !contact?.purchaseTimeline
        ) {
          return NextResponse.json(
            {
              error:
                "Para avanzar a Discovery Hecho, el contacto debe tener perfil de inversión, tipo de propiedad, presupuesto y horizonte de compra completados.",
            },
            { status: 400 }
          );
        }
      }

      // Regla: RESERVED requiere unidad asignada (Hub o local legacy)
      if (newStage === "RESERVED") {
        const unitId = data.unitId || existingDeal.unitId || existingDeal.hubUnitId;
        if (!unitId) {
          return NextResponse.json(
            { error: "Se requiere una unidad asignada para reservar." },
            { status: 400 }
          );
        }
      }

      // Regla: LOST requiere motivo
      if (newStage === "LOST" && !data.lostReason) {
        return NextResponse.json(
          { error: "Se requiere un motivo de pérdida." },
          { status: 400 }
        );
      }

      // Regla: WON requiere fecha de cierre
      if (newStage === "WON" && !data.actualCloseDate) {
        // Auto-asignar fecha actual si no se proporciona
        data.actualCloseDate = new Date();
      }
    }

    // Preparar datos de actualización
    const updateData: any = {};
    if (data.stage !== undefined) {
      updateData.stage = data.stage;
      // Actualizar probabilidad automáticamente según la etapa
      updateData.probability = data.probability || DEAL_STAGE_PROBABILITY[data.stage] || 0;
    }
    if (data.dealType !== undefined) updateData.dealType = data.dealType;
    if (data.estimatedValue !== undefined) updateData.estimatedValue = data.estimatedValue;
    if (data.currency !== undefined) updateData.currency = data.currency;
    if (data.probability !== undefined && !data.stage) updateData.probability = data.probability;
    if (data.expectedCloseDate !== undefined) updateData.expectedCloseDate = data.expectedCloseDate;
    if (data.developmentId !== undefined) updateData.developmentId = data.developmentId;
    if (data.unitId !== undefined) updateData.unitId = data.unitId;
    if (data.assignedToId !== undefined) updateData.assignedToId = data.assignedToId;
    if (data.lostReason !== undefined) updateData.lostReason = data.lostReason;
    if (data.lostReasonDetail !== undefined) updateData.lostReasonDetail = data.lostReasonDetail;

    // WON: fecha de cierre real y cálculo de comisiones
    if (data.stage === "WON") {
      updateData.actualCloseDate = data.actualCloseDate || new Date();

      // Comisiones por el motor de commission-engine, no por porcentajes a mano (#D-01).
      // `existingDeal` ya trae `development.commissionRate`, así que no hace falta otra
      // consulta. Sin desarrollo, el motor aplica su tabla por tipo de operación en vez
      // de dejar el negocio sin comisión calculada.
      Object.assign(
        updateData,
        dealCommissionFields({
          estimatedValue: data.estimatedValue || Number(existingDeal.estimatedValue),
          dealType: data.dealType ?? existingDeal.dealType,
          leadSourceAtDeal: existingDeal.leadSourceAtDeal,
          externalBrokerId: existingDeal.externalBrokerId,
          developmentCommissionRate:
            existingDeal.development?.commissionRate != null
              ? Number(existingDeal.development.commissionRate)
              : null,
        })
      );
    }

    // Hub hold al reservar (SOT del inventario). Un conflicto del Hub BLOQUEA la transición.
    // Se toma ANTES de abrir la transacción porque es una llamada HTTP; si la
    // transacción falla después, el catch lo libera.
    let holdTomadoEnHub: string | null = null;
    if (data.stage === "RESERVED" && existingDeal.hubUnitId) {
      const { requestUnitHold } = await import("@/lib/hub/client");
      const hold = await requestUnitHold({ hubUnitId: existingDeal.hubUnitId, crmDealId: existingDeal.id });
      if (!hold.ok) {
        return NextResponse.json(
          { error: `No se pudo apartar la unidad en el Hub: ${hold.error ?? "no disponible"}` },
          { status: 409 }
        );
      }
      holdTomadoEnHub = existingDeal.hubUnitId;
      updateData.holdId = hold.unit?.id ?? existingDeal.hubUnitId;
      updateData.holdExpiresAt = hold.unit?.holdExpiresAt ? new Date(hold.unit.holdExpiresAt) : null;
      updateData.reservedAt = new Date();
    }

    // #D-02: el deal, la unidad, los contadores del desarrollo y la actividad se
    // escriben en UNA transacción. Antes eran cuatro escrituras suel­tas: si la de la
    // unidad fallaba a media operación, el negocio quedaba WON con comisiones
    // calculadas y la unidad seguía DISPONIBLE, sin rastro de la divergencia.
    // Las llamadas HTTP al Hub quedan fuera a propósito (no se pueden revertir).
    const huboCambioDeEtapa = !!data.stage && data.stage !== existingDeal.stage;

    let updatedDeal;
    try {
      updatedDeal = await withChangeSource(
        { source: "api", actorId: session.user.id },
        async (tx) => {
          const deal = await tx.deal.update({
            where: { id: params.id },
            data: updateData,
            include: {
              contact: { select: { id: true, firstName: true, lastName: true } },
              assignedTo: { select: { id: true, name: true } },
              development: { select: { id: true, name: true } },
              unit: { select: { id: true, unitNumber: true } },
            },
          });

          // Inventario local (legacy, sólo deals con unitId del CRM). Sólo en una
          // transición real de etapa, y el movimiento lo decide el estado que la
          // unidad tenía ANTES — ver lib/deals/stage-inventory.ts.
          if (
            huboCambioDeEtapa &&
            deal.unitId &&
            (data.stage === "RESERVED" || data.stage === "WON")
          ) {
            await aplicarInventarioDeEtapa(tx, {
              unitId: deal.unitId,
              developmentId: existingDeal.developmentId,
              toStage: data.stage,
              contactId: existingDeal.contactId,
              assignedToId: existingDeal.assignedToId,
              salePrice: deal.estimatedValue,
            });
          }

          if (huboCambioDeEtapa && data.stage) {
            await tx.activity.create({
              data: actividadDeCambioDeEtapa({
                contactId: existingDeal.contactId,
                dealId: existingDeal.id,
                userId: session.user.id,
                fromStage: existingDeal.stage,
                toStage: data.stage,
                lostReason: data.lostReason,
                lostReasonDetail: data.lostReasonDetail,
              }),
            });
          }

          return deal;
        }
      );
    } catch (err) {
      // Si ya tomamos el hold en el Hub y la transacción no cerró, liberarlo: si no, la
      // unidad queda bloqueada allá por un negocio que aquí no avanzó.
      if (holdTomadoEnHub) {
        const { releaseUnitHold } = await import("@/lib/hub/client");
        await releaseUnitHold({
          hubUnitId: holdTomadoEnHub,
          crmDealId: existingDeal.id,
        }).catch(() => null);
      }
      throw err;
    }

    // Hub: confirmar venta al ganar (SOT). No bloquea el WON; el webhook reconcilia.
    if (data.stage === "WON" && existingDeal.hubUnitId) {
      const { confirmUnitHold } = await import("@/lib/hub/client");
      await confirmUnitHold({ hubUnitId: existingDeal.hubUnitId, crmDealId: existingDeal.id }).catch(() => null);
    }

    return NextResponse.json({ data: updatedDeal });
  } catch (error) {
    console.error("Error al actualizar deal:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
