import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { slaPolicyInputSchema } from "@/lib/workflows/sla-model";

const MANAGE_ROLES = ["ADMIN", "DIRECTOR"];

export async function POST(req: Request) {
  const session = await getServerSession();
  if (!session?.user || !MANAGE_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Solo Dirección/Admin" }, { status: 403 });
  }
  const parsed = slaPolicyInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const d = parsed.data;

  let policy;
  try {
    policy = await prisma.$transaction(async (tx) => {
      if (d.isDefault) await tx.slaPolicy.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
      return tx.slaPolicy.create({
        data: {
          name: d.name, isActive: d.isActive, isDefault: d.isDefault, priority: d.priority,
          conditions: d.conditions as object, businessHours: d.businessHours as object,
          firstTouchMinutes: d.firstTouchMinutes, retryMinutes: d.retryMinutes, orphanHours: d.orphanHours,
        },
      });
    });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") {
      return NextResponse.json({ error: "Ya existe una política con ese nombre" }, { status: 409 });
    }
    throw e;
  }

  await prisma.auditLog.create({
    data: { userId: session.user.id, action: "CREATE", entity: "SlaPolicy", entityId: policy.id,
      changes: JSON.parse(JSON.stringify(d)) },
  });
  return NextResponse.json({ data: policy }, { status: 201 });
}
