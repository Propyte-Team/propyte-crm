import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { slaPolicyInputSchema } from "@/lib/workflows/sla-model";

const MANAGE_ROLES = ["ADMIN", "DIRECTOR"];

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getServerSession();
  if (!session?.user || !MANAGE_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Solo Dirección/Admin" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const parsed = slaPolicyInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const d = parsed.data;

  let policy;
  try {
    policy = await prisma.$transaction(async (tx) => {
      const exists = await tx.slaPolicy.findUnique({ where: { id }, select: { id: true } });
      if (!exists) throw { code: "P2025" };
      if (d.isDefault) await tx.slaPolicy.updateMany({ where: { isDefault: true, NOT: { id } }, data: { isDefault: false } });
      return tx.slaPolicy.update({
        where: { id },
        data: {
          name: d.name, isActive: d.isActive, isDefault: d.isDefault, priority: d.priority,
          conditions: d.conditions as object, businessHours: d.businessHours as object,
          firstTouchMinutes: d.firstTouchMinutes, retryMinutes: d.retryMinutes, orphanHours: d.orphanHours,
        },
      });
    });
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "P2002") return NextResponse.json({ error: "Ya existe una política con ese nombre" }, { status: 409 });
    if (code === "P2025") return NextResponse.json({ error: "Política no encontrada" }, { status: 404 });
    throw e;
  }

  await prisma.auditLog.create({
    data: { userId: session.user.id, action: "UPDATE", entity: "SlaPolicy", entityId: id,
      changes: JSON.parse(JSON.stringify(d)) },
  });
  return NextResponse.json({ data: policy }, { status: 200 });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getServerSession();
  if (!session?.user || !MANAGE_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Solo Dirección/Admin" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const target = await prisma.slaPolicy.findUnique({ where: { id }, select: { isDefault: true } });
  if (!target) return NextResponse.json({ error: "Política no encontrada" }, { status: 404 });
  if (target.isDefault) return NextResponse.json({ error: "No se puede borrar la política default" }, { status: 400 });

  await prisma.$transaction(async (tx) => {
    await tx.slaTimer.updateMany({ where: { policyId: id }, data: { policyId: null } });
    await tx.slaPolicy.delete({ where: { id } });
  });

  await prisma.auditLog.create({
    data: { userId: session.user.id, action: "DELETE", entity: "SlaPolicy", entityId: id, changes: {} },
  });
  return NextResponse.json({ ok: true }, { status: 200 });
}
