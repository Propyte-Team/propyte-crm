// RuleEngine — evalúa AutomationRule contra un WorkflowEvent y encola acciones.
// Reglas y secuencias viven en JSONB (data-driven, §D.1); este es el único intérprete.
import prisma from "@/lib/db";
import type { AutomationRule, WorkflowEvent } from "@prisma/client";
import { evaluateConditions } from "./evaluate-conditions";
import { workflowActionsSchema } from "@/lib/validations/rebuild-f1";
import { walkNodes } from "./walk-nodes";
import { enqueueAction, dayBucket } from "./queue";
import {
  estaEnHorarioLaboral,
  HORARIO_POR_DEFECTO,
  type BusinessHours,
} from "./business-hours";

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
    case "LIFECYCLE_CHANGE":
      return (
        event.type === "contact.lifecycle_changed" &&
        (cfg.toStage === undefined || (payload as { toStage?: string }).toStage === cfg.toStage)
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

// Carga el contexto de un entity (sin requerir un WorkflowEvent). Compartido por
// buildContext (motor) y el scheduler (exitConditions de cadencias).
export async function loadEntityContext(
  entityType: string,
  entityId: string,
): Promise<Record<string, unknown>> {
  const ctx: Record<string, unknown> = {};
  const withAd = { adAttribution: true } as const;
  if (entityType === "contact") {
    ctx.contact = await prisma.contact.findUnique({ where: { id: entityId }, include: withAd });
  } else if (entityType === "deal") {
    const deal = await prisma.deal.findUnique({ where: { id: entityId } });
    ctx.deal = deal;
    if (deal) ctx.contact = await prisma.contact.findUnique({ where: { id: deal.contactId }, include: withAd });
  } else if (entityType === "conversation") {
    const conv = await prisma.conversation.findUnique({ where: { id: entityId } });
    if (conv) ctx.contact = await prisma.contact.findUnique({ where: { id: conv.contactId }, include: withAd });
  }
  const c = ctx.contact as { score?: unknown } | null;
  if (c && typeof c === "object") (c as Record<string, unknown>).score = Number((c as { score?: unknown }).score ?? 0);
  ctx.adAttribution = (ctx.contact as { adAttribution?: unknown } | null)?.adAttribution ?? null;
  return ctx;
}

// Contexto para el DSL: { contact, deal, event, context }
export async function buildContext(event: WorkflowEvent): Promise<Record<string, unknown>> {
  const entityCtx = await loadEntityContext(event.entityType, event.entityId);
  return {
    ...entityCtx,
    event: { type: event.type, payload: event.payload ?? {} },
    context: { isBusinessHours: await isBusinessHoursNow() },
  };
}

/**
 * ¿Estamos en horario laboral? (#680)
 *
 * Antes esto era una segunda definición de horario laboral, escrita a mano aquí: 09-18 en
 * América/Cancún, sábado laborable, y sin mirar la configuración. Convivía con la
 * configurable de `SlaPolicy.businessHours`, que es la que decide los plazos de los relojes
 * de atención — así que una regla podía considerar que el sábado a las cinco es horario de
 * oficina mientras el reloj, con una política que cierra sábados, consideraba que no. Su
 * propio comentario admitía que era un provisional: «afinable por SlaPolicy.businessHours
 * en F2.1». Esto es esa F2.1.
 *
 * Ahora hay una sola definición, en `business-hours.ts`, la misma que consume `computeDueAt`.
 * El orden de preferencia es explícito:
 *
 *   1. La agenda de la SlaPolicy por defecto, si existe y es válida.
 *   2. HORARIO_POR_DEFECTO, que reproduce exactamente lo que hacía el código anterior.
 *
 * El fallback se conserva —y no se devuelve `false`— porque una regla condicionada a
 * "estamos en horario de oficina" que nunca dispara es un fallo silencioso, y este arreglo
 * no debe cambiar qué reglas disparan: solo de dónde sale el calendario.
 */
async function isBusinessHoursNow(): Promise<boolean> {
  const policy = await prisma.slaPolicy
    .findFirst({ where: { isDefault: true, isActive: true } })
    .catch(() => null);

  const agenda = (policy?.businessHours as unknown as BusinessHours | null) ?? null;
  const conPolitica = estaEnHorarioLaboral(new Date(), agenda);
  if (conPolitica !== null) return conPolitica;

  return estaEnHorarioLaboral(new Date(), HORARIO_POR_DEFECTO) ?? false;
}

export async function processEvent(eventId: string): Promise<void> {
  const event = await prisma.workflowEvent.findUnique({ where: { id: eventId } });
  if (!event || event.processedAt) return;

  const rules = await prisma.automationRule.findMany({
    where: { isActive: true, deletedAt: null },
    orderBy: { priority: "asc" },
  });

  const applicable = rules.filter((r) => matchesTrigger(r, event));

  // ctx se necesita para el auto-avance del lifecycle (independiente de reglas) y para evaluar reglas.
  const needsLifecycle = event.type !== "contact.lifecycle_changed";
  if (applicable.length > 0 || needsLifecycle) {
    const ctx = await buildContext(event);

    // Auto-avance del lifecycle (forward-only) — corre haya o no reglas configuradas.
    if (needsLifecycle) {
      const c = ctx.contact as { id: string; score: number; contactType: string; lifecycleStage: import("@prisma/client").LifecycleStage | null } | null;
      if (c?.id) {
        const { maybeAdvanceLifecycleFromEvent } = await import("@/lib/lifecycle/apply");
        const { getQualifiedThreshold } = await import("@/lib/lifecycle/threshold");
        await maybeAdvanceLifecycleFromEvent(event.type, c, await getQualifiedThreshold()).catch((e) =>
          console.error("[lifecycle] auto-advance:", e));
      }
    }

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

      const parsedActions = workflowActionsSchema.safeParse(rule.actions);
      if (!parsedActions.success) {
        console.error(`[workflows] árbol de acciones inválido en regla "${rule.name}"`);
        continue;
      }
      const specs = walkNodes(parsedActions.data, ctx);
      for (const spec of specs) {
        const runAfter = new Date(Date.now() + (spec.delayMinutes ?? 0) * 60_000);
        // Auditoría 2026-09-10: el `false` de `enqueueAction` (colisión de dedupeKey) se
        // descartaba sin más. Como la clave incluye `dayBucket(runAfter)`, una regla sólo
        // puede encolar la misma acción UNA VEZ AL DÍA por entidad y ruta — así que un
        // segundo disparo legítimo (dos cambios de etapa el mismo día, por ejemplo) se
        // caía en silencio y desde fuera parecía que la regla no había disparado.
        //
        // La idempotencia diaria se mantiene: es la protección contra bucles de eventos
        // (§D.7). Lo que cambia es que ahora queda rastro de cuándo actúa, para poder
        // distinguir «la regla no aplicó» de «aplicó y se descartó por repetida».
        const encolada = await enqueueAction({
          ruleId: rule.id,
          actionType: spec.actionType as never,
          entityType: event.entityType,
          entityId: event.entityId,
          config: { ...spec.config, autonomyLevel: spec.autonomyLevel },
          dedupeKey: `${rule.id}:${event.entityId}:${spec.actionType}:${spec.path}:${dayBucket(runAfter)}`,
          runAfter,
        });
        if (!encolada) {
          console.info(
            `[workflows] regla "${rule.name}": ${spec.actionType} para ${event.entityType} ` +
              `${event.entityId} ya estaba encolada hoy (dedupeKey diario) — no se repite`,
          );
        }
      }
      await prisma.automationRule.update({ where: { id: rule.id }, data: { lastFiredAt: new Date() } });
    }
  }

  await prisma.workflowEvent.update({ where: { id: event.id }, data: { processedAt: new Date() } });
}
