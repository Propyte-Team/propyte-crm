// Centro de configuración — Automatización (workflows, SLA, cadencias).
// GET: todo el estado · PATCH: toggle de regla/plan o edición de SLA.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";

const MANAGE_ROLES = ["ADMIN", "DIRECTOR"];

export async function GET() {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const [rules, plans, slaPolicies, queueStats] = await Promise.all([
    prisma.automationRule.findMany({
      where: { deletedAt: null },
      orderBy: { priority: "asc" },
      select: {
        id: true, name: true, description: true, isActive: true, priority: true,
        triggerType: true, triggerConfig: true, actions: true, cooldownMinutes: true,
        lastFiredAt: true,
      },
    }),
    prisma.actionPlan.findMany({
      where: { deletedAt: null },
      orderBy: { name: "asc" },
      include: { steps: { orderBy: { order: "asc" } }, _count: { select: { enrollments: true } } },
    }),
    prisma.slaPolicy.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { timers: true } } } }),
    prisma.actionQueue.groupBy({ by: ["status"], _count: { id: true } }).catch(() => []),
  ]);

  return NextResponse.json({
    data: {
      rules,
      plans,
      slaPolicies,
      queue: Object.fromEntries((queueStats as Array<{ status: string; _count: { id: number } }>).map((q) => [q.status, q._count.id])),
    },
  });
}

const patchSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("rule"), id: z.string().uuid(), isActive: z.boolean() }),
  z.object({ kind: z.literal("plan"), id: z.string().uuid(), isActive: z.boolean() }),
  z.object({
    kind: z.literal("sla"),
    id: z.string().uuid(),
    firstTouchMinutes: z.number().int().min(1).max(1440).optional(),
    retryMinutes: z.number().int().min(1).max(1440).optional(),
    orphanHours: z.number().int().min(1).max(720).optional(),
  }),
]);

export async function PATCH(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user || !MANAGE_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Solo Dirección/Admin" }, { status: 403 });
  }
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const p = parsed.data;

  let result: unknown;
  if (p.kind === "rule") {
    result = await prisma.automationRule.update({ where: { id: p.id }, data: { isActive: p.isActive } });
  } else if (p.kind === "plan") {
    result = await prisma.actionPlan.update({ where: { id: p.id }, data: { isActive: p.isActive } });
  } else {
    const { kind, id, ...fields } = p;
    result = await prisma.slaPolicy.update({ where: { id }, data: fields });
  }

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: "UPDATE",
      entity: `Automation:${p.kind}`,
      entityId: p.id,
      changes: JSON.parse(JSON.stringify(p)),
    },
  }).catch(() => {});

  return NextResponse.json({ data: result });
}
