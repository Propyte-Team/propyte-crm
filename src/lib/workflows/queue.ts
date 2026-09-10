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

// ─────────────── Rescate de acciones encalladas (auditoría 2026-09-10) ───────────────
//
// `runQueue` marca la fila como RUNNING para reclamarla, y sólo la mueve a DONE/FAILED
// cuando `executeAction` termina. Si el proceso se muere en medio —un reinicio del VPS, un
// despliegue, o el `maxDuration = 60` del tick agotado a mitad de un envío— la fila se
// queda en RUNNING PARA SIEMPRE: el selector de abajo sólo mira `status: "PENDING"`, así
// que nadie la vuelve a tomar y nadie la marca como fallida.
//
// El resultado es la peor clase de fallo: silencioso. Un correo, un WhatsApp o una tarea
// de seguimiento que el motor dio por encolada y que no se envía nunca, sin aparecer en
// ningún contador de errores. Antes de esto no había una sola consulta en el repositorio
// que leyera `ActionQueue` con estado RUNNING.
//
// No hace falta migración: `startedAt`, `attempts` y `maxAttempts` ya están en el modelo.
//
// El umbral es holgado a propósito. Una acción legítima no pasa de los 60s que dura el
// tick; diez minutos hace imposible rescatar una que todavía esté corriendo, que sería
// duplicar el envío — justo lo que el `dedupeKey` existe para evitar y que aquí no
// aplicaría, porque la fila es la misma.
const ENCALLADA_MS = 10 * 60_000;

export async function recuperarEncalladas(
  batch = 50,
): Promise<{ reencoladas: number; agotadas: number }> {
  const limite = new Date(Date.now() - ENCALLADA_MS);
  const encalladas = await prisma.actionQueue.findMany({
    where: { status: "RUNNING", startedAt: { lt: limite } },
    orderBy: { startedAt: "asc" },
    take: batch,
    select: { id: true, attempts: true, maxAttempts: true, actionType: true, entityId: true },
  });

  let reencoladas = 0;
  let agotadas = 0;

  for (const item of encalladas) {
    // `attempts` ya se incrementó al reclamarla, así que este intento cuenta.
    const quedanIntentos = item.attempts < item.maxAttempts;
    // Guard de estado en el WHERE: si otro runner la resucitó entre el findMany y esto,
    // el updateMany no toca nada en vez de pisarlo.
    const r = await prisma.actionQueue.updateMany({
      where: { id: item.id, status: "RUNNING" },
      data: quedanIntentos
        ? { status: "PENDING", runAfter: new Date(), startedAt: null, error: "Reencolada: se quedó en RUNNING sin terminar" }
        : { status: "FAILED", finishedAt: new Date(), error: `Encallada en RUNNING tras ${item.attempts} intento(s); sin reintentos restantes` },
    });
    if (r.count === 0) continue;
    if (quedanIntentos) reencoladas++;
    else agotadas++;
    console.warn(
      `[workflows/queue] acción encallada ${item.actionType} (${item.entityId}) → ` +
        `${quedanIntentos ? "reencolada" : "FAILED"} (intento ${item.attempts}/${item.maxAttempts})`,
    );
  }

  return { reencoladas, agotadas };
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
