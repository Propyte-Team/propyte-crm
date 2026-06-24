import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { planInputSchema, normalizeStepsOrder } from "@/lib/workflows/cadence-model";

const MANAGE_ROLES = ["ADMIN", "DIRECTOR"];

export async function POST(req: Request) {
  const session = await getServerSession();
  if (!session?.user || !MANAGE_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Solo Dirección/Admin" }, { status: 403 });
  }
  const parsed = planInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { name, description, exitConditions, steps } = parsed.data;

  let plan;
  try {
    plan = await prisma.actionPlan.create({
      data: {
        name, description: description ?? null, ownerUserId: session.user.id,
        exitConditions: (exitConditions ?? {}) as object,
        steps: { create: normalizeStepsOrder(steps).map((s) => ({
          order: s.order, actionType: s.actionType, delayMinutes: s.delayMinutes,
          config: s.config as object, autonomyLevel: s.autonomyLevel,
        })) },
      },
    });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") {
      return NextResponse.json({ error: "Ya existe una cadencia con ese nombre" }, { status: 409 });
    }
    throw e;
  }

  await prisma.auditLog.create({
    data: { userId: session.user.id, action: "CREATE", entity: "ActionPlan", entityId: plan.id,
      changes: JSON.parse(JSON.stringify(parsed.data)) },
  });
  return NextResponse.json({ data: plan }, { status: 201 });
}
