// ============================================================
// API Route: /api/deals/[id]
// Operaciones sobre un deal específico
// GET   - Obtener detalle completo
// PATCH - Actualizar deal (incluye transiciones de etapa con reglas)
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { FLUJO_ORDER } from "@/lib/flujos";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { DEAL_STAGE_PROBABILITY } from "@/lib/constants";
import { dueDateSchema } from "@/lib/due-date";
import { dealCommissionFields } from "@/lib/commission-engine/for-deal";
import { withChangeSource } from "@/lib/audit/change-context";
import { aplicarInventarioDeEtapa } from "@/lib/deals/stage-inventory";
import { actividadDeCambioDeEtapa } from "@/lib/deals/stage-activity";
import { getVisibleBrands } from "@/lib/brands/user-access";
import { CONTACT_BRAND_SELECT, canSeeDealBrand } from "@/lib/brands/visibility";
import { avisarAsignacion } from "@/lib/notificaciones/avisar-asignacion";
import {
  TIPO_OPERACION_ORDER,
  ETAPA_OPERACION_ORDER,
  FORMA_PAGO_ORDER,
  NIVEL_MB_ORDER,
  CLAVES_DE_OPERACION,
  validarCambioDeOperacion,
  type DatosDeOperacion,
} from "@/lib/operaciones";

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
  // #948: flujo del negocio (F1–F8). null = «Sin flujo». Lista única: lib/flujos.ts.
  flujo: z.enum(FLUJO_ORDER).nullable().optional(),
  estimatedValue: z.number().positive().optional(),
  currency: z.enum(["MXN", "USD"]).optional(),
  probability: z.number().int().min(0).max(100).optional(),
  // Hora de pared de Cancún si el string no trae zona — ver src/lib/due-date.ts
  expectedCloseDate: dueDateSchema.optional(),
  developmentId: z.string().guid().optional().nullable(),
  unitId: z.string().guid().optional().nullable(),
  assignedToId: z.string().guid().optional(),
  lostReason: z.enum([
    "PRECIO", "COMPETENCIA", "FINANCIAMIENTO_RECHAZADO", "NO_INTERESADO",
    "NO_CONTACTABLE", "COMPRO_DIRECTO", "DESARROLLO_CANCELADO", "OTRO",
  ]).optional(),
  lostReasonDetail: z.string().max(500).optional(),
  actualCloseDate: dueDateSchema.optional(),
  // #957: la operación. La etapa nueva decide la vieja (`stage`): ver lib/operaciones.ts.
  tipoOperacion: z.enum(TIPO_OPERACION_ORDER).optional(),
  etapa: z.enum(ETAPA_OPERACION_ORDER).optional(),
  subestado: z.string().trim().max(60).nullable().optional(),
  contratoFirmado: z.boolean().optional(),
  enganchePagado: z.boolean().optional(),
  reapartar: z.boolean().optional(),
  formaPago: z.enum(FORMA_PAGO_ORDER).nullable().optional(),
  vigenciaHasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (AAAA-MM-DD)").nullable().optional(),
  porcentajeComision: z.number().min(0).max(100).nullable().optional(),
  nivelMb: z.enum(NIVEL_MB_ORDER).nullable().optional(),
  propiedadDescripcion: z.string().trim().max(500).nullable().optional(),
  // Unidad del Hub (SOT del inventario): para apartar una operación que se preparó sin unidad.
  hubDevelopmentId: z.string().min(1).nullable().optional(),
  hubUnitId: z.string().min(1).nullable().optional(),
  // Corrección de un administrador: se salta las etapas permitidas (no las reglas de la etapa vieja).
  forzarCambio: z.boolean().optional(),
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
          // Las pide el filtro por marca (2026-10-12).
          assignedToId: true, brands: CONTACT_BRAND_SELECT,
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

  // Marcas (2026-10-12): encima del rol, para GET y PATCH. Fuera de marca = null → el mismo
  // 404 "no encontrado o sin acceso" que fuera de alcance.
  const visible = await getVisibleBrands({ id: userId, role: userRole });
  if (!canSeeDealBrand(deal, { id: userId }, visible)) return null;

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
export async function GET(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
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
export async function PATCH(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
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
    // #957: operación. La etapa nueva (Apartado, Firma, Escritura, Postventa, Cancelada) se traduce
    // a la etapa vieja y de ahí pasa por las MISMAS reglas de siempre (unidad, hold del Hub,
    // inventario, comisión al ganar). La etapa vieja de una operación ya no se mueve sola.
    // =============================================
    if (data.forzarCambio && userRole !== "ADMIN") {
      return NextResponse.json(
        { error: "Solo un administrador puede corregir una operación fuera de sus etapas", fields: ["etapa"] },
        { status: 403 }
      );
    }
    let datosOperacion: DatosDeOperacion = {};
    const tocaOperacion = CLAVES_DE_OPERACION.some((k) => data[k] !== undefined);
    if (tocaOperacion) {
      const r = validarCambioDeOperacion(
        {
          tipoOperacion: existingDeal.tipoOperacion ?? null,
          etapa: existingDeal.etapa ?? null,
          subestado: existingDeal.subestado ?? null,
          contratoFirmado: existingDeal.contratoFirmado ?? false,
          enganchePagado: existingDeal.enganchePagado ?? false,
          flujo: existingDeal.flujo ?? null,
        },
        {
          tipoOperacion: data.tipoOperacion,
          etapa: data.etapa,
          subestado: data.subestado,
          contratoFirmado: data.contratoFirmado,
          enganchePagado: data.enganchePagado,
          reapartar: data.reapartar,
        },
        { forzar: data.forzarCambio === true }
      );
      if (!r.ok) {
        return NextResponse.json({ error: r.error, fields: [r.campo] }, { status: 400 });
      }
      datosOperacion = r.datos;
      // Un negocio de antes que se vuelve «en preparación» conserva su etapa vieja (no retrocede).
      const soloPreparar = r.datos.etapa === "EN_PREPARACION" && !existingDeal.etapa;
      // Una venta ya ganada (con su comisión calculada) no regresa a una etapa vieja anterior por
      // moverle el subestado de la firma o avanzar a Escritura/Postventa; solo sale si se cancela.
      const ganadaSeQueda = existingDeal.stage === "WON" && r.stage !== "LOST";
      if (r.stage && r.stage !== existingDeal.stage && !soloPreparar && !ganadaSeQueda) data.stage = r.stage as typeof data.stage;
      if (r.datos.etapa === "CANCELADA" && !data.lostReason) {
        data.lostReason = "OTRO";
        data.lostReasonDetail = data.lostReasonDetail ?? "Canceló apartado o contrato";
      }
    } else if (data.stage && data.stage !== existingDeal.stage && existingDeal.etapa && !data.forzarCambio) {
      return NextResponse.json(
        { error: "Esta operación avanza por su etapa (Apartado, Firma, Escritura, Postventa) desde la ficha del contacto", fields: ["stage"] },
        { status: 400 }
      );
    }
    const hubUnitIdEfectivo = data.hubUnitId !== undefined ? data.hubUnitId : existingDeal.hubUnitId;

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
        const unitId = data.unitId || existingDeal.unitId || hubUnitIdEfectivo; // #957: o la que viene en el cambio
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
    if (data.flujo !== undefined) updateData.flujo = data.flujo; // #948
    if (data.estimatedValue !== undefined) updateData.estimatedValue = data.estimatedValue;
    if (data.currency !== undefined) updateData.currency = data.currency;
    if (data.probability !== undefined && !data.stage) updateData.probability = data.probability;
    if (data.expectedCloseDate !== undefined) updateData.expectedCloseDate = data.expectedCloseDate;
    if (data.developmentId !== undefined) updateData.developmentId = data.developmentId;
    if (data.unitId !== undefined) updateData.unitId = data.unitId;
    if (data.assignedToId !== undefined) updateData.assignedToId = data.assignedToId;
    if (data.lostReason !== undefined) updateData.lostReason = data.lostReason;
    if (data.lostReasonDetail !== undefined) updateData.lostReasonDetail = data.lostReasonDetail;

    // #957: columnas de la operación y fechas que se llenan solas con la etapa.
    if (datosOperacion.tipoOperacion !== undefined) updateData.tipoOperacion = datosOperacion.tipoOperacion;
    if (datosOperacion.etapa !== undefined) updateData.etapa = datosOperacion.etapa;
    if (datosOperacion.subestado !== undefined) updateData.subestado = datosOperacion.subestado;
    if (datosOperacion.contratoFirmado !== undefined) updateData.contratoFirmado = datosOperacion.contratoFirmado;
    if (datosOperacion.enganchePagado !== undefined) updateData.enganchePagado = datosOperacion.enganchePagado;
    if (datosOperacion.reapartar) {
      updateData.reapartados = { increment: 1 };
      updateData.reservedAt = new Date(); // cada reapartado reinicia el reloj de 15 días (Luis, 02-nov)
    }
    const etapaFinal = datosOperacion.etapa ?? existingDeal.etapa;
    const subFinal = datosOperacion.subestado !== undefined ? datosOperacion.subestado : existingDeal.subestado;
    if (datosOperacion.etapa === "APARTADO" && !existingDeal.reservedAt) updateData.reservedAt = new Date();
    if ((datosOperacion.contratoFirmado || subFinal === "FIRMADO" || subFinal === "DEVENGO_ACTIVO") && etapaFinal === "FIRMA" && !existingDeal.contractSignedAt) {
      updateData.contractSignedAt = new Date();
    }
    if (etapaFinal === "ESCRITURA" && subFinal === "ESCRITURADO" && !existingDeal.deedAt) updateData.deedAt = new Date();
    if (etapaFinal === "POSTVENTA" && subFinal === "ENTREGADA" && !existingDeal.deliveredAt) updateData.deliveredAt = new Date();
    if (data.formaPago !== undefined) updateData.formaPago = data.formaPago;
    if (data.vigenciaHasta !== undefined) updateData.vigenciaHasta = data.vigenciaHasta ? new Date(`${data.vigenciaHasta}T00:00:00.000Z`) : null;
    if (data.porcentajeComision !== undefined) updateData.porcentajeComision = data.porcentajeComision;
    if (data.nivelMb !== undefined) updateData.nivelMb = data.nivelMb;
    if (data.propiedadDescripcion !== undefined) updateData.propiedadDescripcion = data.propiedadDescripcion || null;
    if (data.hubDevelopmentId !== undefined) updateData.hubDevelopmentId = data.hubDevelopmentId;
    if (data.hubUnitId !== undefined) updateData.hubUnitId = data.hubUnitId;
    // Unidad nueva del Hub (al apartar una operación que se preparó sin unidad): se valida contra el
    // Hub y se congela su copia, igual que al crear el negocio.
    if (data.hubUnitId && data.hubUnitId !== existingDeal.hubUnitId) {
      const { getHubUnit } = await import("@/lib/hub/client");
      const hubUnit = await getHubUnit(data.hubUnitId);
      if (!hubUnit) {
        return NextResponse.json({ error: "Unidad del Hub no encontrada", fields: ["hubUnitId"] }, { status: 404 });
      }
      const customPrevio =
        existingDeal.custom && typeof existingDeal.custom === "object" && !Array.isArray(existingDeal.custom)
          ? (existingDeal.custom as Record<string, unknown>)
          : {};
      updateData.custom = {
        ...customPrevio,
        hubUnitSnapshot: { ...hubUnit, snapshotAt: new Date().toISOString(), source: "hub" },
      };
    }

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
    // #957: también al reapartar (renueva el hold) y con la unidad que se elige al apartar.
    const tomaHold = (data.stage === "RESERVED" && data.stage !== existingDeal.stage) || datosOperacion.reapartar;
    if (tomaHold && hubUnitIdEfectivo) {
      const { requestUnitHold } = await import("@/lib/hub/client");
      const hold = await requestUnitHold({ hubUnitId: hubUnitIdEfectivo, crmDealId: existingDeal.id });
      if (!hold.ok) {
        return NextResponse.json(
          { error: `No se pudo apartar la unidad en el Hub: ${hold.error ?? "no disponible"}` },
          { status: 409 }
        );
      }
      holdTomadoEnHub = hubUnitIdEfectivo;
      updateData.holdId = hold.unit?.id ?? hubUnitIdEfectivo;
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
    if (data.stage === "WON" && data.stage !== existingDeal.stage && hubUnitIdEfectivo) {
      const { confirmUnitHold } = await import("@/lib/hub/client");
      await confirmUnitHold({ hubUnitId: hubUnitIdEfectivo, crmDealId: existingDeal.id }).catch(() => null);
    }

    // #915: cambiar el asesor de un negocio le avisa al nuevo. Solo si de verdad cambió.
    if (data.assignedToId && data.assignedToId !== existingDeal.assignedToId) {
      await avisarAsignacion({
        tipo: "negocio",
        negocioId: existingDeal.id,
        contactoNombre: updatedDeal.contact
          ? `${updatedDeal.contact.firstName} ${updatedDeal.contact.lastName}`
          : null,
        desarrollo: updatedDeal.development?.name ?? null,
        asignadoId: data.assignedToId,
        actorId: session.user.id,
        actorNombre: session.user.name,
      });
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
