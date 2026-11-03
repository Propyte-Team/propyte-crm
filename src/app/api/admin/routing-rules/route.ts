// Reglas de ruteo (RoutingRule) desde Configuración → Equipos & Territorios.
// Lectura: mando (ADMIN/DIRECTOR/GERENTE). Crear: ADMIN/DIRECTOR, igual que equipos.
// El motor que las aplica es `autoRouteLead` (lib/workflows/routing.ts); aquí solo se escriben.
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { routingRuleCreateSchema } from "@/lib/validations/routing-rule";

const READ_ROLES = ["ADMIN", "DIRECTOR", "GERENTE"];
const CREATE_ROLES = ["ADMIN", "DIRECTOR"];

export async function GET() {
  const session = await getServerSession();
  if (!session?.user || !READ_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }
  const rules = await prisma.routingRule.findMany({
    where: { deletedAt: null },
    orderBy: [{ priority: "asc" }, { name: "asc" }],
  });
  return NextResponse.json({ data: rules });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user || !CREATE_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Solo Dirección/Admin crean reglas de ruteo" }, { status: 403 });
  }
  const parsed = routingRuleCreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const d = parsed.data;
  const dup = await prisma.routingRule.findFirst({ where: { name: d.name, deletedAt: null }, select: { id: true } });
  if (dup) return NextResponse.json({ error: "Ya existe una regla de ruteo con ese nombre" }, { status: 409 });

  const rule = await prisma.routingRule.create({
    data: {
      name: d.name,
      priority: d.priority,
      isActive: d.isActive,
      conditions: d.conditions as never,
      strategy: d.strategy,
      targets: d.targets as never,
    },
  });
  await prisma.auditLog
    .create({ data: { userId: session.user.id, action: "CREATE", entity: "RoutingRule", entityId: rule.id, changes: { name: rule.name } } })
    .catch(() => {});

  return NextResponse.json({ data: rule }, { status: 201 });
}
