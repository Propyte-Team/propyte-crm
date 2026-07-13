// Contexto transaccional para enriquecer propyte_crm.record_field_changes (cronología).
// El trigger propyte_crm.log_field_changes() lee crm.source / crm.actor_id vía
// current_setting(..., true) — hay que fijarlos con set_config(..., true) DENTRO de la
// MISMA transacción que hace el UPDATE, o el trigger igual audita pero source/actor_id
// quedan NULL (comportamiento aceptado — ver spec).
import prisma from "@/lib/db";
import type { Prisma } from "@prisma/client";

export type PrismaTx = Prisma.TransactionClient;

export interface ChangeSourceOpts {
  source: string;
  actorId?: string | null;
}

// Para usar DENTRO de una transacción ya abierta por el caller (evita anidar $transaction).
export async function setChangeSource(tx: PrismaTx, opts: ChangeSourceOpts): Promise<void> {
  const actorId = opts.actorId ?? "";
  await tx.$executeRaw`SELECT set_config('crm.source', ${opts.source}, true), set_config('crm.actor_id', ${actorId}, true)`;
}

// Abre su propia transacción: fija crm.source/crm.actor_id y corre `fn` con el cliente
// transaccional. Úsalo cuando el caller todavía no está dentro de un $transaction.
export async function withChangeSource<T>(
  opts: ChangeSourceOpts,
  fn: (tx: PrismaTx) => Promise<T>
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await setChangeSource(tx, opts);
    return fn(tx);
  });
}
