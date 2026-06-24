// Scheduler — corre por tiempo (cron): enrollments de action plans y reglas INACTIVITY.
import prisma from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { enqueueAction, dayBucket } from "./queue";
import { evaluateConditions } from "./evaluate-conditions";
import { loadEntityContext } from "./engine";

export async function enrollInPlan(
  planId: string,
  entityType: string,
  entityId: string
): Promise<boolean> {
  const plan = await prisma.actionPlan.findUnique({
    where: { id: planId },
    include: { steps: { orderBy: { order: "asc" }, take: 1 } },
  });
  if (!plan || !plan.isActive || plan.deletedAt) return false;

  try {
    const firstDelay = plan.steps[0]?.delayMinutes ?? 0;
    await prisma.actionPlanEnrollment.create({
      data: {
        planId,
        entityType,
        entityId,
        currentStep: 0,
        nextRunAt: new Date(Date.now() + firstDelay * 60_000),
      },
    });
    return true;
  } catch (err: unknown) {
    if (typeof err === "object" && err && (err as { code?: string }).code === "P2002") return false; // ya enrolado
    throw err;
  }
}

// Avanza enrollments vencidos: encola la acción del paso actual y agenda el siguiente.
export async function runEnrollments(limit = 50): Promise<number> {
  const due = await prisma.actionPlanEnrollment.findMany({
    where: { status: "ACTIVE", nextRunAt: { lte: new Date() } },
    take: limit,
    include: { plan: { include: { steps: { orderBy: { order: "asc" } } } } },
  });

  for (const enr of due) {
    const steps = enr.plan.steps;
    const step = steps[enr.currentStep];

    if (!step || !enr.plan.isActive) {
      await prisma.actionPlanEnrollment.update({
        where: { id: enr.id },
        data: { status: step ? "EXITED" : "COMPLETED", exitedAt: new Date(), nextRunAt: null },
      });
      continue;
    }

    // Condiciones de salida del plan (sub-B): si matchean, salir antes de encolar.
    const exitCond = enr.plan.exitConditions as Record<string, unknown> | null;
    if (step && enr.plan.isActive && exitCond && Object.keys(exitCond).length > 0) {
      const ctx = await loadEntityContext(enr.entityType, enr.entityId);
      if (evaluateConditions(exitCond as never, ctx as never)) {
        await prisma.actionPlanEnrollment.update({
          where: { id: enr.id },
          data: { status: "EXITED", exitedAt: new Date(), nextRunAt: null },
        });
        continue;
      }
    }

    await enqueueAction({
      planStepId: step.id,
      actionType: step.actionType,
      entityType: enr.entityType,
      entityId: enr.entityId,
      config: { ...(step.config as Record<string, unknown>), autonomyLevel: step.autonomyLevel },
      dedupeKey: `plan:${step.id}:${enr.entityId}:${dayBucket(new Date())}`,
    });

    const nextStep = steps[enr.currentStep + 1];
    await prisma.actionPlanEnrollment.update({
      where: { id: enr.id },
      data: nextStep
        ? { currentStep: enr.currentStep + 1, nextRunAt: new Date(Date.now() + nextStep.delayMinutes * 60_000) }
        : { status: "COMPLETED", exitedAt: new Date(), nextRunAt: null },
    });
  }
  return due.length;
}

// Reglas INACTIVITY (WF3 anti-huérfano, WF7 dormidos): contactos sin actividad en N horas.
export async function runInactivityRules(limit = 200): Promise<number> {
  const rules = await prisma.automationRule.findMany({
    where: { isActive: true, deletedAt: null, triggerType: "INACTIVITY" },
    orderBy: { priority: "asc" },
  });
  let fired = 0;

  for (const rule of rules) {
    const cfg = (rule.triggerConfig ?? {}) as { hours?: number };
    const hours = typeof cfg.hours === "number" ? cfg.hours : 24;
    const cutoff = new Date(Date.now() - hours * 3_600_000);

    const stale = await prisma.contact.findMany({
      where: {
        deletedAt: null,
        mergedIntoId: null,
        doNotContact: false,
        OR: [{ lastActivityAt: { lte: cutoff } }, { lastActivityAt: null, createdAt: { lte: cutoff } }],
      },
      take: limit,
    });

    for (const contact of stale) {
      const ctx = { contact: { ...contact, score: Number(contact.score) }, context: {} };
      if (!evaluateConditions(rule.conditions as never, ctx)) continue;

      const actions = Array.isArray(rule.actions) ? (rule.actions as Prisma.JsonArray) : [];
      let idx = 0;
      for (const raw of actions) {
        const spec = raw as { type?: string; config?: Record<string, unknown>; autonomyLevel?: string; delayMinutes?: number };
        if (!spec.type) continue;
        const enqueued = await enqueueAction({
          ruleId: rule.id,
          actionType: spec.type as never,
          entityType: "contact",
          entityId: contact.id,
          config: { ...(spec.config ?? {}), autonomyLevel: spec.autonomyLevel },
          // bucket por ventana de cooldown (default diario) para no repetir cada minuto
          dedupeKey: `${rule.id}:${contact.id}:${spec.type}:${idx}:${dayBucket(new Date())}`,
          runAfter: new Date(Date.now() + (spec.delayMinutes ?? 0) * 60_000),
        });
        if (enqueued) fired++;
        idx++;
      }
    }
  }
  return fired;
}
