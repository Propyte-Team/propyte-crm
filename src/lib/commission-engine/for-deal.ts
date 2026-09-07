// ============================================================
// Puente entre un Deal y el motor de comisiones (#D-01)
// ============================================================
// Antes de esto, las dos rutas que cierran un negocio calculaban la comisión con
// porcentajes escritos a mano (40/10/5/5 sobre la tasa del desarrollo) y el motor
// de `commission-engine` no tenía un solo llamador. Consecuencias medidas en la
// auditoría del 2026-09-03:
//
//   1. `commissionBrokerExt` nunca se escribía → el broker externo cobraba 0.
//   2. Un negocio sin `developmentId` (corretaje, unidad del Hub) no calculaba NADA:
//      `commissionTotal` quedaba en null y el KPI lo contaba como cero.
//   3. Solo se repartía el 60% y sin redondeo a 2 decimales.
//
// Este módulo es PURO a propósito (no toca la base de datos) para que se pueda probar
// sin Prisma. La parte que consulta vive en `./deal-commissions.ts`.

import type { DealType, LeadSourceCategory } from "@prisma/client";
import { calculateDealCommissions } from "./index";

/**
 * Fuentes de lead que son prospección del propio asesor: el asesor lo trajo sin que
 * Propyte gastara en generarlo, así que le toca la tajada mayor (40%).
 */
const ASESOR_LEAD_SOURCES = new Set(["SELF_GEN", "LLAMADA_FRIA", "BASE_DE_DATOS"]);

/**
 * Fuentes que vienen de un broker o referidor externo. Ojo: `REFERIDO_CLIENTE` NO está
 * aquí — un cliente que refiere ya es cliente de Propyte, así que ese lead es de la casa.
 */
const BROKER_LEAD_SOURCES = new Set(["REFERIDO_BROKER", "REGISTRO_BROKER"]);

/**
 * Deriva la categoría de fuente que el motor de comisiones necesita, a partir de lo que
 * el Deal sí guarda: `leadSourceAtDeal` (texto libre, normalmente un valor de LeadSource)
 * y `externalBrokerId`.
 *
 * Regla, en orden:
 *   1. Si el negocio tiene broker externo asignado → BROKER_LEAD, pase lo que pase.
 *      El broker está registrado en el negocio: hay que pagarle.
 *   2. Si la fuente es de broker/referidor → BROKER_LEAD.
 *   3. Si la fuente es prospección propia del asesor → ASESOR_LEAD.
 *   4. En cualquier otro caso → PROPYTE_LEAD.
 *
 * El default es PROPYTE_LEAD por dos razones: cubre lo que de hecho domina el embudo
 * (campañas, portales, walk-in, web, DM) y, ante una fuente desconocida o vacía, es la
 * opción conservadora para la empresa. Un lead mal clasificado se corrige a mano; un
 * pago de más ya salió.
 */
export function resolveLeadSourceCategory(deal: {
  leadSourceAtDeal?: string | null;
  externalBrokerId?: string | null;
}): LeadSourceCategory {
  if (deal.externalBrokerId) return "BROKER_LEAD";

  const source = (deal.leadSourceAtDeal ?? "").trim().toUpperCase();
  if (BROKER_LEAD_SOURCES.has(source)) return "BROKER_LEAD";
  if (ASESOR_LEAD_SOURCES.has(source)) return "ASESOR_LEAD";

  return "PROPYTE_LEAD";
}

export interface DealCommissionInput {
  estimatedValue: number;
  dealType: DealType;
  leadSourceAtDeal?: string | null;
  externalBrokerId?: string | null;
  /**
   * `Development.commissionRate` tal como está en la base: en porcentaje (13.03 = 13.03%),
   * no en tanto por uno. Se convierte aquí. Null o ausente → el motor usa su tabla por
   * tipo de operación, que es lo que arregla el hueco del negocio sin desarrollo.
   */
  developmentCommissionRate?: number | null;
}

/**
 * Devuelve los seis campos de comisión listos para `prisma.deal.update()`.
 * Un solo lugar para que las dos rutas de cierre calculen igual.
 */
export function dealCommissionFields(input: DealCommissionInput) {
  const leadSourceCategory = resolveLeadSourceCategory(input);

  const rate = input.developmentCommissionRate;
  const baseRate =
    typeof rate === "number" && Number.isFinite(rate) && rate > 0 ? rate / 100 : undefined;

  return calculateDealCommissions({
    estimatedValue: input.estimatedValue,
    dealType: input.dealType,
    leadSourceCategory,
    baseRate,
  });
}
