// ActionQueue — cola pg-backed (decisión Anexo B §K G.5).
// Idempotencia por dedupeKey UNIQUE; claim optimista; reintentos con backoff.
import prisma from "@/lib/db";
import type { ActionQueue, Prisma } from "@prisma/client";
import { executeAction } from "./actions";

export function dayBucket(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function enqueueAction(input: {
  ruleId?: string | null;
  planStepId?: string | null;
  actionType: ActionQueue["actionType"];
  entityType: string;
  entityId: string;
  config: Record<string, unknown>;
  dedupeKey: string;
  runAfter?: Date;
}): Promise<boolean> {
  try {
    await prisma.actionQueue.create({
      data: {
        ruleId: input.ruleId ?? null,
        planStepId: input.planStepId ?? null,
        actionType: input.actionType,
        entityType: input.entityType,
        entityId: input.entityId,
        config: input.config as Prisma.InputJsonValue,
        dedupeKey: input.dedupeKey,
        runAfter: input.runAfter ?? new Date(),
      },
    });
    return true;
  } catch (err: unknown) {
    // P2002 = dedupeKey duplicado → ya encolada hoy, idempotente (§D.7)
    if (typeof err === "object" && err && (err as { code?: string }).code === "P2002") return false;
    throw err;
  }
}

// Procesa hasta `batch` acciones vencidas. Claim optimista: updateMany con guard de status.
export async function runQueue(batch = 20): Promise<{ ran: number; failed: number; skipped: number }> {
  const now = new Date();
  const candidates = await prisma.actionQueue.findMany({
    where: { status: "PENDING", runAfter: { lte: now } },
    orderBy: { runAfter: "asc" },
    take: batch,
  });

  let ran = 0, failed = 0, skipped = 0;
  for (const item of candidates) {
    const claimed = await prisma.actionQueue.updateMany({
      where: { id: item.id, status: "PENDING" },
      data: { status: "RUNNING", startedAt: new Date(), attempts: { increment: 1 } },
    });
    if (claimed.count === 0) continue; // otro runner la tomó

    try {
      const result = await executeAction(item);
      await prisma.actionQueue.update({
        where: { id: item.id },
        data: {
          status: result.skipped ? "SKIPPED" : "DONE",
          finishedAt: new Date(),
          error: result.note ?? null,
        },
      });
      result.skipped ? skipped++ : ran++;
    } catch (err) {
      const willRetry = item.attempts + 1 < item.maxAttempts;
      await prisma.actionQueue.update({
        where: { id: item.id },
        data: {
          status: willRetry ? "PENDING" : "FAILED",
          // backoff: 5 min × intento
          runAfter: willRetry ? new Date(Date.now() + 5 * 60_000 * (item.attempts + 1)) : item.runAfter,
          finishedAt: willRetry ? null : new Date(),
          error: String(err instanceof Error ? err.message : err).slice(0, 2000),
        },
      });
      failed++;
    }
  }
  return { ran, failed, skipped };
}
