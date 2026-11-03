// PATCH edita (ADMIN/DIRECTOR/GERENTE) · DELETE borra en blando (ADMIN/DIRECTOR).
// Borrado blando (`deletedAt`): el motor filtra `deletedAt: null` y el historial de
// auditoría sigue apuntando a una fila que existe.
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { routingRulePatchSchema } from "@/lib/validations/routing-rule";

const MANAGE_ROLES = ["ADMIN", "DIRECTOR", "GERENTE"];
const DELETE_ROLES = ["ADMIN", "DIRECTOR"];

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const session = await getServerSession();
  if (!session?.user || !MANAGE_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }
  const parsed = routingRulePatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const existing = await prisma.routingRule.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: "Regla no encontrada" }, { status: 404 });

  const d = parsed.data;
  if (d.name) {
    const dup = await prisma.routingRule.findFirst({
      where: { name: d.name, deletedAt: null, NOT: { id } },
      select: { id: true },
    });
    if (dup) return NextResponse.json({ error: "Ya existe una regla de ruteo con ese nombre" }, { status: 409 });
  }

  const rule = await prisma.routingRule.update({
    where: { id },
    data: {
      ...(d.name !== undefined ? { name: d.name } : {}),
      ...(d.priority !== undefined ? { priority: d.priority } : {}),
      ...(d.isActive !== undefined ? { isActive: d.isActive } : {}),
      ...(d.conditions !== undefined ? { conditions: d.conditions as never } : {}),
      ...(d.strategy !== undefined ? { strategy: d.strategy } : {}),
      ...(d.targets !== undefined ? { targets: d.targets as never } : {}),
    },
  });
  await prisma.auditLog
    .create({ data: { userId: session.user.id, action: "UPDATE", entity: "RoutingRule", entityId: id, changes: { changed: Object.keys(d) } } })
    .catch(() => {});

  return NextResponse.json({ data: rule });
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const session = await getServerSession();
  if (!session?.user || !DELETE_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Solo Dirección/Admin eliminan reglas de ruteo" }, { status: 403 });
  }
  const existing = await prisma.routingRule.findFirst({ where: { id, deletedAt: null }, select: { id: true, name: true } });
  if (!existing) return NextResponse.json({ error: "Regla no encontrada" }, { status: 404 });

  await prisma.routingRule.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
  await prisma.auditLog
    .create({ data: { userId: session.user.id, action: "DELETE", entity: "RoutingRule", entityId: id, changes: { name: existing.name } } })
    .catch(() => {});

  return NextResponse.json({ ok: true });
}
