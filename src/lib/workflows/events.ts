// emitEvent — punto de entrada del motor (Anexo Técnico §D.1).
// Persiste el evento (log append-only) y lo procesa de inmediato; el cron
// re-procesa cualquier evento que haya quedado sin processedAt (resiliencia).
import prisma from "@/lib/db";
import { processEvent } from "./engine";

export type DomainEventType =
  | "contact.created"
  | "lead.captured"
  | "lead.assigned"
  | "lead.reassigned"
  | "contact.scored"
  | "contact.merged"
  | "contact.opted_out"
  | "deal.created"
  | "deal.stage_changed"
  | "deal.won"
  | "deal.lost"
  | "quote.opened"
  | "whatsapp.replied"
  | "payment.overdue"
  | "visit.completed"
  | "sla.breach"
  | (string & {});

export async function emitEvent(
  type: DomainEventType,
  entityType: "contact" | "deal" | "conversation" | "system",
  entityId: string,
  payload: Record<string, unknown> = {}
): Promise<void> {
  const event = await prisma.workflowEvent.create({
    data: { type, entityType, entityId, payload: payload as object },
  });
  // Procesamiento inline best-effort: un fallo aquí NO debe romper la operación
  // de dominio que emitió el evento; el cron lo recogerá después.
  try {
    await processEvent(event.id);
  } catch (err) {
    console.error(`[workflows] processEvent diferido para ${event.id}:`, err);
  }
}

// Re-procesa eventos pendientes (cron). Devuelve cuántos procesó.
export async function processPendingEvents(limit = 50): Promise<number> {
  const pending = await prisma.workflowEvent.findMany({
    where: { processedAt: null },
    orderBy: { occurredAt: "asc" },
    take: limit,
    select: { id: true },
  });
  for (const e of pending) {
    try {
      await processEvent(e.id);
    } catch (err) {
      console.error(`[workflows] error procesando evento ${e.id}:`, err);
    }
  }
  return pending.length;
}
