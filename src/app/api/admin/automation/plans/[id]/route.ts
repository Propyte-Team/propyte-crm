import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { planInputSchema, normalizeStepsOrder } from "@/lib/workflows/cadence-model";

const MANAGE_ROLES = ["ADMIN", "DIRECTOR"];

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getServerSession();
  if (!session?.user || !MANAGE_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Solo Dirección/Admin" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const parsed = planInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { name, description, exitConditions, steps } = parsed.data;
  const ordered = normalizeStepsOrder(steps);

  const plan = await prisma.$transaction(async (tx) => {
    await tx.actionPlanStep.deleteMany({ where: { planId: id } });
    await tx.actionPlanStep.createMany({
      data: ordered.map((s) => ({
        planId: id, order: s.order, actionType: s.actionType, delayMinutes: s.delayMinutes,
        config: s.config as object, autonomyLevel: s.autonomyLevel,
      })),
    });
    return tx.actionPlan.update({
      where: { id },
      data: { name, description: description ?? null, exitConditions: (exitConditions ?? {}) as object },
    });
  });

  await prisma.auditLog.create({
    data: { userId: session.user.id, action: "UPDATE", entity: "ActionPlan", entityId: id,
      changes: JSON.parse(JSON.stringify(parsed.data)) },
  });
  return NextResponse.json({ data: plan }, { status: 200 });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getServerSession();
  if (!session?.user || !MANAGE_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Solo Dirección/Admin" }, { status: 403 });
  }
  const { id } = await ctx.params;
  await prisma.actionPlan.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
  await prisma.auditLog.create({
    data: { userId: session.user.id, action: "DELETE", entity: "ActionPlan", entityId: id, changes: {} },
  });
  return NextResponse.json({ ok: true }, { status: 200 });
}
