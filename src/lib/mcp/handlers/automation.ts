// src/lib/mcp/handlers/automation.ts
import { z } from "zod";
import prisma from "@/lib/db";
import { conditionsDslSchema, workflowActionTypes } from "@/lib/validations/rebuild-f1";
import { writeAudit } from "../respond";

const TRIGGER_TYPES = ["EVENT", "TIME", "BEHAVIORAL", "INACTIVITY", "STAGE_CHANGE", "SLA_BREACH", "SCORE_THRESHOLD"] as const;

// --- AutomationRule ---

const ruleSchema = z.object({
  name: z.string().min(3).max(120).trim(),
  description: z.string().max(500).nullable().optional(),
  triggerType: z.enum(TRIGGER_TYPES),
  triggerConfig: z.record(z.unknown()).default({}),
  conditions: conditionsDslSchema,
  actions: z.array(z.object({ type: z.enum(workflowActionTypes), config: z.record(z.unknown()).default({}) })).min(1),
  cooldownMinutes: z.number().int().min(0).max(43200).nullable().optional(),
  priority: z.number().int().min(1).max(1000).default(100),
  isActive: z.boolean().default(false),
});

export async function listRules() {
  return prisma.automationRule.findMany({ where: { deletedAt: null }, orderBy: { priority: "asc" } });
}
export async function getRule(id: string) {
  const r = await prisma.automationRule.findFirst({ where: { id, deletedAt: null } });
  if (!r) throw new Error("Regla no encontrada");
  return r;
}
export async function createRule(body: unknown, userId: string) {
  const d = ruleSchema.parse(body);
  if (await prisma.automationRule.findFirst({ where: { name: d.name, deletedAt: null } }))
    throw new Error("Ya existe una regla con ese nombre");
  const rule = await prisma.automationRule.create({ data: {
    name: d.name, description: d.description ?? null, triggerType: d.triggerType,
    triggerConfig: d.triggerConfig as never, conditions: d.conditions as never, actions: d.actions as never,
    cooldownMinutes: d.cooldownMinutes ?? null, priority: d.priority, isActive: d.isActive,
  } });
  await writeAudit(userId, "CREATE", "AutomationRule", rule.id, { name: d.name });
  return rule;
}
export async function updateRule(id: string, body: unknown, userId: string) {
  const existing = await prisma.automationRule.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new Error("Regla no encontrada");
  const d = ruleSchema.partial().parse(body);
  if (d.name && await prisma.automationRule.findFirst({ where: { name: d.name, deletedAt: null, id: { not: id } } }))
    throw new Error("Ya existe otra regla con ese nombre");
  const rule = await prisma.automationRule.update({ where: { id }, data: {
    ...(d.name !== undefined ? { name: d.name } : {}),
    ...(d.description !== undefined ? { description: d.description } : {}),
    ...(d.triggerType !== undefined ? { triggerType: d.triggerType } : {}),
    ...(d.triggerConfig !== undefined ? { triggerConfig: d.triggerConfig as never } : {}),
    ...(d.conditions !== undefined ? { conditions: d.conditions as never } : {}),
    ...(d.actions !== undefined ? { actions: d.actions as never } : {}),
    ...(d.cooldownMinutes !== undefined ? { cooldownMinutes: d.cooldownMinutes } : {}),
    ...(d.priority !== undefined ? { priority: d.priority } : {}),
    ...(d.isActive !== undefined ? { isActive: d.isActive } : {}),
  } });
  await writeAudit(userId, "UPDATE", "AutomationRule", rule.id, { name: rule.name, changed: Object.keys(d) });
  return rule;
}

// --- ActionPlan ---

export async function listPlans() {
  return prisma.actionPlan.findMany({ where: { deletedAt: null }, include: { steps: { orderBy: { order: "asc" } } } });
}
export async function getPlan(id: string) {
  const p = await prisma.actionPlan.findFirst({ where: { id, deletedAt: null }, include: { steps: { orderBy: { order: "asc" } } } });
  if (!p) throw new Error("Plan no encontrado");
  return p;
}
const planSchema = z.object({
  name: z.string().min(3).max(120).trim(),
  isActive: z.boolean().default(false),
  ownerUserId: z.string().nullable().optional(),
  entryTrigger: z.record(z.unknown()).default({}),
  exitConditions: z.record(z.unknown()).default({}),
  steps: z.array(z.object({
    order: z.number().int().min(0),
    delayMinutes: z.number().int().min(0).default(0),
    actionType: z.enum(workflowActionTypes),
    config: z.record(z.unknown()).default({}),
    conditions: z.record(z.unknown()).nullable().optional(),
    autonomyLevel: z.enum(["L0", "L1", "L2"]).default("L0"),
  })).default([]),
});
export async function createPlan(body: unknown, userId: string) {
  const d = planSchema.parse(body);
  if (await prisma.actionPlan.findFirst({ where: { name: d.name, deletedAt: null } }))
    throw new Error("Ya existe un plan con ese nombre");
  const plan = await prisma.actionPlan.create({ data: {
    name: d.name, isActive: d.isActive, ownerUserId: d.ownerUserId ?? null,
    entryTrigger: d.entryTrigger as never, exitConditions: d.exitConditions as never,
    steps: { create: d.steps.map((s) => ({
      order: s.order, delayMinutes: s.delayMinutes, actionType: s.actionType,
      config: s.config as never, conditions: (s.conditions ?? null) as never, autonomyLevel: s.autonomyLevel,
    })) },
  }, include: { steps: true } });
  await writeAudit(userId, "CREATE", "ActionPlan", plan.id, { name: d.name, steps: d.steps.length });
  return plan;
}
export async function updatePlan(id: string, body: unknown, userId: string) {
  const existing = await prisma.actionPlan.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new Error("Plan no encontrado");
  const d = planSchema.partial().parse(body);
  // Si vienen steps, reemplaza el set completo (borra steps viejos y recrea).
  const plan = await prisma.$transaction(async (tx) => {
    if (d.steps) {
      await tx.actionPlanStep.deleteMany({ where: { planId: id } });
      await tx.actionPlanStep.createMany({ data: d.steps.map((s) => ({
        planId: id, order: s.order, delayMinutes: s.delayMinutes ?? 0, actionType: s.actionType,
        config: (s.config ?? {}) as never, conditions: (s.conditions ?? null) as never, autonomyLevel: s.autonomyLevel ?? "L0",
      })) });
    }
    return tx.actionPlan.update({ where: { id }, data: {
      ...(d.name !== undefined ? { name: d.name } : {}),
      ...(d.isActive !== undefined ? { isActive: d.isActive } : {}),
      ...(d.ownerUserId !== undefined ? { ownerUserId: d.ownerUserId } : {}),
      ...(d.entryTrigger !== undefined ? { entryTrigger: d.entryTrigger as never } : {}),
      ...(d.exitConditions !== undefined ? { exitConditions: d.exitConditions as never } : {}),
    }, include: { steps: { orderBy: { order: "asc" } } } });
  });
  await writeAudit(userId, "UPDATE", "ActionPlan", id, { changed: Object.keys(d) });
  return plan;
}

// --- RoutingRule ---

const routingSchema = z.object({
  name: z.string().min(3).max(120).trim(),
  priority: z.number().int().min(1).max(1000).default(100),
  // Nace inactiva: activación explícita tras revisión (principio de seguridad del MCP; difiere del default true del modelo).
  isActive: z.boolean().default(false),
  conditions: z.record(z.unknown()).default({}),
  strategy: z.enum(["ROUND_ROBIN", "PERFORMANCE", "MANUAL", "GUARDIA"]),
  targets: z.record(z.unknown()).default({}),
});
export async function listRouting() { return prisma.routingRule.findMany({ where: { deletedAt: null }, orderBy: { priority: "asc" } }); }
export async function createRouting(body: unknown, userId: string) {
  const d = routingSchema.parse(body);
  if (await prisma.routingRule.findFirst({ where: { name: d.name, deletedAt: null } }))
    throw new Error("Ya existe una regla de ruteo con ese nombre");
  const r = await prisma.routingRule.create({ data: {
    name: d.name, priority: d.priority, isActive: d.isActive,
    conditions: d.conditions as never, strategy: d.strategy, targets: d.targets as never,
  } });
  await writeAudit(userId, "CREATE", "RoutingRule", r.id, { name: d.name });
  return r;
}
export async function updateRouting(id: string, body: unknown, userId: string) {
  const existing = await prisma.routingRule.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new Error("Regla de ruteo no encontrada");
  const d = routingSchema.partial().parse(body);
  const r = await prisma.routingRule.update({ where: { id }, data: {
    ...(d.name !== undefined ? { name: d.name } : {}),
    ...(d.priority !== undefined ? { priority: d.priority } : {}),
    ...(d.isActive !== undefined ? { isActive: d.isActive } : {}),
    ...(d.conditions !== undefined ? { conditions: d.conditions as never } : {}),
    ...(d.strategy !== undefined ? { strategy: d.strategy } : {}),
    ...(d.targets !== undefined ? { targets: d.targets as never } : {}),
  } });
  await writeAudit(userId, "UPDATE", "RoutingRule", id, { changed: Object.keys(d) });
  return r;
}

// --- SlaPolicy ---

const slaSchema = z.object({
  name: z.string().min(3).max(120).trim(),
  isDefault: z.boolean().default(false),
  firstTouchMinutes: z.number().int().min(1).default(5),
  retryMinutes: z.number().int().min(1).default(30),
  orphanHours: z.number().int().min(1).default(24),
  escalationChain: z.array(z.record(z.unknown())).default([]),
  businessHours: z.record(z.unknown()).default({}),
  channelFallback: z.record(z.unknown()).default({}),
});
export async function listSla() { return prisma.slaPolicy.findMany({ orderBy: { name: "asc" } }); }
export async function createSla(body: unknown, userId: string) {
  const d = slaSchema.parse(body);
  if (await prisma.slaPolicy.findFirst({ where: { name: d.name } }))
    throw new Error("Ya existe una política SLA con ese nombre");
  const s = await prisma.slaPolicy.create({ data: {
    name: d.name, isDefault: d.isDefault, firstTouchMinutes: d.firstTouchMinutes,
    retryMinutes: d.retryMinutes, orphanHours: d.orphanHours,
    escalationChain: d.escalationChain as never, businessHours: d.businessHours as never, channelFallback: d.channelFallback as never,
  } });
  await writeAudit(userId, "CREATE", "SlaPolicy", s.id, { name: d.name });
  return s;
}
export async function updateSla(id: string, body: unknown, userId: string) {
  const existing = await prisma.slaPolicy.findUnique({ where: { id } });
  if (!existing) throw new Error("Política SLA no encontrada");
  const d = slaSchema.partial().parse(body);
  const s = await prisma.slaPolicy.update({ where: { id }, data: {
    ...(d.name !== undefined ? { name: d.name } : {}),
    ...(d.isDefault !== undefined ? { isDefault: d.isDefault } : {}),
    ...(d.firstTouchMinutes !== undefined ? { firstTouchMinutes: d.firstTouchMinutes } : {}),
    ...(d.retryMinutes !== undefined ? { retryMinutes: d.retryMinutes } : {}),
    ...(d.orphanHours !== undefined ? { orphanHours: d.orphanHours } : {}),
    ...(d.escalationChain !== undefined ? { escalationChain: d.escalationChain as never } : {}),
    ...(d.businessHours !== undefined ? { businessHours: d.businessHours as never } : {}),
    ...(d.channelFallback !== undefined ? { channelFallback: d.channelFallback as never } : {}),
  } });
  await writeAudit(userId, "UPDATE", "SlaPolicy", id, { changed: Object.keys(d) });
  return s;
}

// --- ActionQueue (observabilidad + retry) ---

export async function listQueue() {
  return prisma.actionQueue.findMany({ orderBy: { runAfter: "desc" }, take: 100 });
}
export async function retryQueue(id: string, userId: string) {
  const item = await prisma.actionQueue.findUnique({ where: { id } });
  if (!item) throw new Error("Item de cola no encontrado");
  if (item.status !== "FAILED") throw new Error("Solo se puede reintentar items FAILED");
  const updated = await prisma.actionQueue.update({ where: { id }, data: { status: "PENDING", attempts: 0, error: null, runAfter: new Date() } });
  await writeAudit(userId, "UPDATE", "ActionQueue", id, { action: "retry" });
  return updated;
}
