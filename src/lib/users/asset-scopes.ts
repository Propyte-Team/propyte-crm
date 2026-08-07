// Única fuente de verdad de qué activos de un usuario se cuentan y se mueven.
// El diálogo de reasignación cuenta con `count` y el movimiento usa `move`:
// si un scope se agrega aquí, aparece en los dos lados o en ninguno.
import type { Prisma } from "@prisma/client";

export type AssetScope =
  | "contacts"
  | "deals"
  | "conversations"
  | "units"
  | "walkins"
  | "quotes";

type Tx = Prisma.TransactionClient;

interface ScopeDef {
  /** Etiqueta en español para el diálogo. */
  label: string;
  /** Cuántos activos vivos de este scope tiene el usuario. */
  count: (tx: Tx, userId: string) => Promise<number>;
  /** Mueve los activos de `fromId` a `toId`. Devuelve cuántas filas cambió. */
  move: (tx: Tx, fromId: string, toId: string) => Promise<number>;
}

export const ASSET_SCOPES: Record<AssetScope, ScopeDef> = {
  contacts: {
    label: "Contactos",
    count: (tx, userId) =>
      tx.contact.count({ where: { assignedToId: userId, deletedAt: null } }),
    move: async (tx, fromId, toId) =>
      (
        await tx.contact.updateMany({
          where: { assignedToId: fromId, deletedAt: null },
          data: { assignedToId: toId },
        })
      ).count,
  },
  deals: {
    label: "Negocios",
    count: (tx, userId) =>
      tx.deal.count({ where: { assignedToId: userId, deletedAt: null } }),
    move: async (tx, fromId, toId) =>
      (
        await tx.deal.updateMany({
          where: { assignedToId: fromId, deletedAt: null },
          data: { assignedToId: toId },
        })
      ).count,
  },
  conversations: {
    // Conversation no tiene deletedAt. Mover controlledById libera además el
    // lock de takeover del inbox: el hilo no queda tomado por una cuenta muerta.
    label: "Conversaciones del inbox",
    count: (tx, userId) =>
      tx.conversation.count({ where: { controlledById: userId } }),
    move: async (tx, fromId, toId) =>
      (
        await tx.conversation.updateMany({
          where: { controlledById: fromId },
          data: { controlledById: toId },
        })
      ).count,
  },
  units: {
    label: "Unidades reservadas",
    count: (tx, userId) =>
      tx.unit.count({ where: { reservedByUserId: userId, deletedAt: null } }),
    move: async (tx, fromId, toId) =>
      (
        await tx.unit.updateMany({
          where: { reservedByUserId: fromId, deletedAt: null },
          data: { reservedByUserId: toId },
        })
      ).count,
  },
  walkins: {
    // Solo el asesor asignado. `hostessId` es el registro histórico de quién
    // recibió a la persona en el showroom, no una asignación de trabajo.
    label: "Walk-ins asignados",
    count: (tx, userId) =>
      tx.walkIn.count({
        where: { assignedAdvisorId: userId, deletedAt: null },
      }),
    move: async (tx, fromId, toId) =>
      (
        await tx.walkIn.updateMany({
          where: { assignedAdvisorId: fromId, deletedAt: null },
          data: { assignedAdvisorId: toId },
        })
      ).count,
  },
  quotes: {
    // Mover `createdById` reescribe la autoría. Es el único vínculo de la
    // cotización con un usuario; sin moverlo nadie puede darle seguimiento.
    // El AuditLog guarda el fromId original para que siga siendo reconstruible.
    label: "Cotizaciones",
    count: (tx, userId) =>
      tx.quote.count({ where: { createdById: userId, deletedAt: null } }),
    move: async (tx, fromId, toId) =>
      (
        await tx.quote.updateMany({
          where: { createdById: fromId, deletedAt: null },
          data: { createdById: toId },
        })
      ).count,
  },
};

export const ASSET_SCOPE_KEYS = Object.keys(ASSET_SCOPES) as AssetScope[];
