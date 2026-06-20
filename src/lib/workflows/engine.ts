// RuleEngine — evalúa AutomationRule contra un WorkflowEvent y encola acciones.
// Reglas y secuencias viven en JSONB (data-driven, §D.1); este es el único intérprete.
import prisma from "@/lib/db";
import type { AutomationRule, WorkflowEvent } from "@prisma/client";
import { evaluateConditions } from "./evaluate-conditions";
import { actionSpecSchema } from "@/lib/validations/rebuild-f1";
import { enqueueAction, dayBucket } from "./queue";

// ¿El trigger de la regla aplica a este evento? (INACTIVITY/TIME corren por scheduler, no aquí)
export function matchesTrigger(rule: Pick<AutomationRule, "triggerType" | "triggerConfig">, event: Pick<WorkflowEvent, "type" | "payload">): boolean {
  const cfg = (rule.triggerConfig ?? {}) as Record<string, unknown>;
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  switch (rule.triggerType) {
    case "EVENT":
      return cfg.eventType === event.type;
    case "STAGE_CHANGE":
      return (
        event.type === "deal.stage_changed" &&
        (cfg.toStage === undefined || payload.toStage === cfg.toStage)
      );
    case "SLA_BREACH":
      return event.type === "sla.breach";
    case "SCORE_THRESHOLD":
      return (
        event.type === "contact.scored" &&
        typeof payload.score === "number" &&
        typeof cfg.threshold === "number" &&
        payload.score >= cfg.threshold
      );
    case "BEHAVIORAL":
      return cfg.eventType === event.type;
    default:
      return false; // INACTIVITY / TIME → scheduler.ts
  }
}

// Contexto para el DSL: { contact, deal, event, context }
export async function buildContext(event: WorkflowEvent): Promise<Record<string, unknown>> {
  const ctx: Record<string, unknown> = {
    event: { type: event.type, payload: event.payload ?? {} },
    context: { isBusinessHours: isBusinessHoursNow() },
  };
  const withAd = { adAttribution: true } as const;
  if (event.entityType === "contact") {
    ctx.contact = await prisma.contact.findUnique({ where: { id: event.entityId }, include: withAd });
  } else if (event.entityType === "deal") {
    const deal = await prisma.deal.findUnique({ where: { id: event.entityId } });
    ctx.deal = deal;
    if (deal) ctx.contact = await prisma.contact.findUnique({ where: { id: deal.contactId }, include: withAd });
  } else if (event.entityType === "conversation") {
    const conv = await prisma.conversation.findUnique({ where: { id: event.entityId } });
    if (conv) ctx.contact = await prisma.contact.findUnique({ where: { id: conv.contactId }, include: withAd });
  }
  // Decimal de Prisma no compara con number en el DSL → normalizar score/value usados típicamente
  const c = ctx.contact as { score?: unknown } | null;
  if (c && typeof c === "object") (c as Record<string, unknown>).score = Number((c as { score?: unknown }).score ?? 0);
  // Exponer atribución en el DSL: reglas pueden condicionar por adAttribution.campaignName/network/...
  ctx.adAttribution = (ctx.contact as { adAttribution?: unknown } | null)?.adAttribution ?? null;
  return ctx;
}

// Horario laboral simple 09-18 hora Cancún (afinable por SlaPolicy.businessHours en F2.1)
function isBusinessHoursNow(): boolean {
  const cancun = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Cancun" }));
  const h = cancun.getHours();
  const day = cancun.getDay(); // 0=domingo
  return day !== 0 && h >= 9 && h < 18;
}

export async function processEvent(eventId: string): Promise<void> {
  const event = await prisma.workflowEvent.findUnique({ where: { id: eventId } });
  if (!event || event.processedAt) return;

  const rules = await prisma.automationRule.findMany({
    where: { isActive: true, deletedAt: null },
    orderBy: { priority: "asc" },
  });

  const applicable = rules.filter((r) => matchesTrigger(r, event));
  if (applicable.length > 0) {
    const ctx = await buildContext(event);
    for (const rule of applicable) {
      // Cooldown por regla+entidad: si ya se encoló algo de esta regla para esta
      // entidad dentro de la ventana, se salta (evita loops de eventos, §D.7)
      if (rule.cooldownMinutes) {
        const since = new Date(Date.now() - rule.cooldownMinutes * 60_000);
        const recent = await prisma.actionQueue.findFirst({
          where: { ruleId: rule.id, entityId: event.entityId, createdAt: { gte: since } },
          select: { id: true },
        });
        if (recent) continue;
      }

      if (!evaluateConditions(rule.conditions as never, ctx)) continue;

      const actions = Array.isArray(rule.actions) ? rule.actions : [];
      let idx = 0;
      for (const raw of actions) {
        const parsed = actionSpecSchema.safeParse(raw);
        if (!parsed.success) {
          console.error(`[workflows] acción inválida en regla "${rule.name}" idx ${idx}`);
          idx++;
          continue;
        }
        const spec = parsed.data;
        const runAfter = new Date(Date.now() + (spec.delayMinutes ?? 0) * 60_000);
        await enqueueAction({
          ruleId: rule.id,
          actionType: spec.type,
          entityType: event.entityType,
          entityId: event.entityId,
          config: { ...spec.config, autonomyLevel: spec.autonomyLevel },
          dedupeKey: `${rule.id}:${event.entityId}:${spec.type}:${idx}:${dayBucket(runAfter)}`,
          runAfter,
        });
        idx++;
      }
      await prisma.automationRule.update({ where: { id: rule.id }, data: { lastFiredAt: new Date() } });
    }
  }

  await prisma.workflowEvent.update({ where: { id: event.id }, data: { processedAt: new Date() } });
}
