// ============================================================
// Inventario al cambiar de etapa un negocio (#D-02)
// ============================================================
// Antes de esto, los contadores de `Development` se movían con la etapa DESTINO como
// única condición:
//
//     if (data.stage === "RESERVED" && updatedDeal.unitId) {
//       ... reservedUnits: { increment: 1 }, availableUnits: { decrement: 1 }
//
// Sin comparar contra la etapa anterior. Dos formas de dejar el inventario en números
// imposibles, ambas reproducibles:
//
//   1. Un doble clic (o un reintento del cliente) sobre un negocio YA reservado volvía a
//      incrementar `reservedUnits` y a decrementar `availableUnits`.
//   2. Un salto de etapa —NEGOTIATION → WON, que ninguna regla impide— hacía
//      `reservedUnits - 1` sobre un negocio que nunca reservó, dejando el contador
//      negativo de forma permanente.
//
// En `server/deals.ts` había además un intento de guarda que no guardaba nada: releía la
// unidad DESPUÉS de marcarla VENDIDA y comprobaba `if (currentUnit)`, que siempre es
// verdadero. El comentario decía "solo actualizar si antes estaba apartada"; el código no
// lo hacía.
//
// La corrección de fondo: **el estado de la unidad ANTES del cambio es lo que dice de qué
// cubeta sale**, no la etapa del negocio. Con eso el movimiento se vuelve idempotente por
// construcción: repetir la misma transición no mueve nada, porque la unidad ya no está en
// la cubeta de origen.

import type { PrismaTx } from "@/lib/audit/change-context";

export type EtapaConInventario = "RESERVED" | "WON";
export type EstadoUnidad = "DISPONIBLE" | "APARTADA" | "VENDIDA" | "NO_DISPONIBLE";

/** Deltas a aplicar sobre los contadores de `Development`. */
export interface DeltasInventario {
  availableUnits?: number;
  reservedUnits?: number;
  soldUnits?: number;
}

/**
 * Qué contadores mueve la unidad, según la cubeta de la que sale.
 * `null` = no mover nada (la unidad ya estaba donde la transición la quiere dejar).
 */
export function deltasParaEtapa(
  toStage: EtapaConInventario,
  statusAntes: EstadoUnidad | null
): DeltasInventario | null {
  if (toStage === "RESERVED") {
    // Solo cuenta si sale de disponible. Si ya estaba apartada (doble clic, o apartada
    // por otro negocio), los contadores ya reflejan esa reserva.
    return statusAntes === "DISPONIBLE" ? { reservedUnits: 1, availableUnits: -1 } : null;
  }

  // WON
  if (statusAntes === "APARTADA") return { soldUnits: 1, reservedUnits: -1 };
  // Salto de etapa sin pasar por RESERVED: la unidad sale de disponible, no de apartada.
  if (statusAntes === "DISPONIBLE") return { soldUnits: 1, availableUnits: -1 };
  // Ya vendida (reintento) o no disponible: nada que mover.
  return null;
}

/** Traduce los deltas a la forma que espera Prisma. */
export function deltasAPrisma(deltas: DeltasInventario) {
  const data: Record<string, { increment: number } | { decrement: number }> = {};
  for (const [campo, delta] of Object.entries(deltas)) {
    if (!delta) continue;
    data[campo] = delta > 0 ? { increment: delta } : { decrement: -delta };
  }
  return data;
}

export interface AplicarInventarioArgs {
  unitId: string;
  developmentId?: string | null;
  toStage: EtapaConInventario;
  contactId: string;
  assignedToId?: string | null;
  salePrice?: unknown;
}

/**
 * Marca la unidad y ajusta los contadores del desarrollo, DENTRO de la transacción que
 * abre el llamador. Devuelve el estado que tenía la unidad, para poder afirmarlo en las
 * pruebas y en la bitácora.
 */
export async function aplicarInventarioDeEtapa(
  tx: PrismaTx,
  args: AplicarInventarioArgs
): Promise<{ statusAntes: EstadoUnidad | null; deltas: DeltasInventario | null }> {
  const antes = await tx.unit.findUnique({
    where: { id: args.unitId },
    select: { status: true },
  });
  const statusAntes = (antes?.status ?? null) as EstadoUnidad | null;

  if (args.toStage === "RESERVED") {
    await tx.unit.update({
      where: { id: args.unitId },
      data: {
        status: "APARTADA",
        reservationDate: new Date(),
        reservedByContactId: args.contactId,
        reservedByUserId: args.assignedToId ?? null,
      },
    });
  } else {
    await tx.unit.update({
      where: { id: args.unitId },
      data: {
        status: "VENDIDA",
        saleDate: new Date(),
        salePrice: args.salePrice as never,
      },
    });
  }

  const deltas = deltasParaEtapa(args.toStage, statusAntes);
  if (deltas && args.developmentId) {
    await tx.development.update({
      where: { id: args.developmentId },
      data: deltasAPrisma(deltas),
    });
  }

  return { statusAntes, deltas };
}
