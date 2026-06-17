import type { Prisma } from "@prisma/client";
import prisma from "@/lib/db";
import { monthRange, computeGoalProgress, type GoalStatus } from "@/lib/goals/progress";

type Scope = "USER" | "TEAM" | "COMPANY";
type Metric =
  | "CAPTACIONES" | "NEGOCIOS_CREADOS" | "COTIZACIONES_ENVIADAS"
  | "ACTIVIDADES_COMPLETADAS" | "NEGOCIOS_GANADOS" | "MONTO_VENTA";

async function ownerIdsForScope(
  scope: Scope, userId: string | null, teamId: string | null
): Promise<string[] | undefined> {
  if (scope === "USER") return userId ? [userId] : [];
  if (scope === "TEAM") {
    if (!teamId) return [];
    const members = await prisma.teamMember.findMany({
      where: { teamId, leftAt: null }, select: { userId: true },
    });
    return members.map((m) => m.userId);
  }
  return undefined; // COMPANY
}

export async function computeActual(input: {
  metric: Metric; scope: Scope; userId: string | null; teamId: string | null;
  period: Date; currency: "MXN" | "USD" | null;
}): Promise<number> {
  const { start, end } = monthRange(input.period);
  const owners = await ownerIdsForScope(input.scope, input.userId, input.teamId);
  if (owners && owners.length === 0) return 0;
  const ownerIn = owners ? { in: owners } : undefined;

  switch (input.metric) {
    case "CAPTACIONES":
      return prisma.contact.count({
        where: { deletedAt: null, createdAt: { gte: start, lt: end }, ...(ownerIn ? { assignedToId: ownerIn } : {}) },
      });
    case "NEGOCIOS_CREADOS":
      return prisma.deal.count({
        where: { deletedAt: null, createdAt: { gte: start, lt: end }, ...(ownerIn ? { assignedToId: ownerIn } : {}) },
      });
    case "COTIZACIONES_ENVIADAS":
      return prisma.quote.count({
        where: {
          deletedAt: null, status: "SENT", sentAt: { gte: start, lt: end },
          ...(ownerIn ? { deal: { assignedToId: ownerIn } } : {}),
        },
      });
    case "ACTIVIDADES_COMPLETADAS":
      return prisma.activity.count({
        where: { deletedAt: null, status: "COMPLETADA", completedAt: { gte: start, lt: end }, ...(ownerIn ? { userId: ownerIn } : {}) },
      });
    case "NEGOCIOS_GANADOS":
      return prisma.deal.count({
        where: { deletedAt: null, stage: "WON", actualCloseDate: { gte: start, lt: end }, ...(ownerIn ? { assignedToId: ownerIn } : {}) },
      });
    case "MONTO_VENTA": {
      const agg = await prisma.deal.aggregate({
        _sum: { estimatedValue: true },
        where: {
          deletedAt: null, stage: "WON", actualCloseDate: { gte: start, lt: end },
          ...(input.currency ? { currency: input.currency } : {}),
          ...(ownerIn ? { assignedToId: ownerIn } : {}),
        },
      });
      return Number(agg._sum.estimatedValue ?? 0);
    }
  }
}

export interface ScorecardRow {
  goal: {
    id: string; scope: Scope; userId: string | null; teamId: string | null;
    metric: Metric; target: number; currency: "MXN" | "USD" | null; period: string;
  };
  actual: number;
  pct: number;
  status: GoalStatus;
}

export async function upsertGoal(input: {
  scope: Scope; userId?: string | null; teamId?: string | null;
  period: Date; metric: Metric; target: number; currency?: "MXN" | "USD" | null;
  createdById: string;
}): Promise<{ error: string } | { goal: { id: string } }> {
  const userId = input.scope === "USER" ? input.userId ?? null : null;
  const teamId = input.scope === "TEAM" ? input.teamId ?? null : null;
  if (input.scope === "USER" && !userId) return { error: "scope USER requiere userId" };
  if (input.scope === "TEAM" && !teamId) return { error: "scope TEAM requiere teamId" };
  const currency = input.metric === "MONTO_VENTA" ? input.currency ?? "MXN" : null;
  if (input.target <= 0) return { error: "target debe ser > 0" };

  const existing = await prisma.goal.findFirst({
    where: { scope: input.scope, userId, teamId, period: input.period, metric: input.metric, currency, deletedAt: null },
    select: { id: true },
  });
  if (existing) {
    const goal = await prisma.goal.update({ where: { id: existing.id }, data: { target: input.target } });
    return { goal: { id: goal.id } };
  }
  const goal = await prisma.goal.create({
    data: {
      scope: input.scope, userId, teamId, period: input.period, metric: input.metric,
      target: input.target, currency, createdById: input.createdById,
    },
  });
  return { goal: { id: goal.id } };
}

export async function deleteGoal(id: string) {
  await prisma.goal.update({ where: { id }, data: { deletedAt: new Date() } });
  return { ok: true as const };
}

export async function getScorecard(filter: {
  period: Date; userId?: string | null; teamId?: string | null;
}): Promise<ScorecardRow[]> {
  const where: Prisma.GoalWhereInput = { deletedAt: null, period: filter.period };
  if (filter.userId) where.userId = filter.userId;
  if (filter.teamId) where.teamId = filter.teamId;
  const goals = await prisma.goal.findMany({ where, orderBy: { metric: "asc" } });
  return Promise.all(
    goals.map(async (g) => {
      const actual = await computeActual({
        metric: g.metric as Metric, scope: g.scope as Scope,
        userId: g.userId, teamId: g.teamId, period: g.period,
        currency: (g.currency as "MXN" | "USD" | null) ?? null,
      });
      const { pct, status } = computeGoalProgress(Number(g.target), actual);
      return {
        goal: {
          id: g.id, scope: g.scope as Scope, userId: g.userId, teamId: g.teamId,
          metric: g.metric as Metric, target: Number(g.target),
          currency: (g.currency as "MXN" | "USD" | null) ?? null,
          period: g.period.toISOString().slice(0, 7),
        },
        actual, pct, status,
      };
    })
  );
}
