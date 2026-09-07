// Parte con base de datos del cálculo de comisiones (#D-01).
// Separada de `for-deal.ts` para que la lógica de reparto se pruebe sin Prisma.

import prisma from "@/lib/db";
import { dealCommissionFields, type DealCommissionInput } from "./for-deal";

/**
 * Calcula las comisiones de un negocio que se está cerrando.
 *
 * Busca la tasa negociada del desarrollo cuando el negocio pertenece a uno; si no
 * pertenece a ninguno (corretaje, unidad del Hub), el motor aplica su tabla por tipo de
 * operación en lugar de no calcular nada, que es lo que pasaba antes.
 *
 * NOTA para quien siga esto: existe una tabla `CommissionRule`
 * (dealType × leadSourceCategory × role → percentage) que se administra desde
 * /admin y que HOY nadie lee para calcular. Cablearla es el paso siguiente y no entra en
 * este arreglo a propósito: su `role` es un `UserRole`, así que hay que decidir primero
 * qué pasa cuando hay reglas distintas para ASESOR, ASESOR_SR y ASESOR_JR — un reparto
 * ambiguo es peor que uno fijo y revisable. Mientras esa decisión no exista, la fuente de
 * verdad es el motor de `commission-engine`.
 */
export async function computeDealCommissions(
  deal: Omit<DealCommissionInput, "developmentCommissionRate"> & {
    developmentId?: string | null;
  }
) {
  const development = deal.developmentId
    ? await prisma.development.findUnique({
        where: { id: deal.developmentId },
        select: { commissionRate: true },
      })
    : null;

  return dealCommissionFields({
    estimatedValue: deal.estimatedValue,
    dealType: deal.dealType,
    leadSourceAtDeal: deal.leadSourceAtDeal,
    externalBrokerId: deal.externalBrokerId,
    developmentCommissionRate:
      development?.commissionRate != null ? Number(development.commissionRate) : null,
  });
}
