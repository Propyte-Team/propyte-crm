// CRUD de territorios + reglas de asignación (speckit Personalización §2).
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { conditionsDslSchema } from "@/lib/validations/rebuild-f1";

const CREATE_ROLES = ["ADMIN", "DIRECTOR"];

const createSchema = z.object({
  name: z.string().min(2).max(120),
  type: z.enum(["GEO", "SEGMENT"]).default("GEO"),
  plaza: z.enum(["PDC", "TULUM", "MERIDA"]).optional(),
  zones: z.array(z.string().max(80)).default([]),
  parentTerritoryId: z.string().uuid().optional(),
  forecastManagerId: z.string().uuid().optional(),
});

export async function GET() {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const territories = await prisma.territory.findMany({
    where: { deletedAt: null },
    orderBy: { name: "asc" },
    include: {
      parentTerritory: { select: { id: true, name: true } },
      forecastManager: { select: { id: true, name: true } },
      members: { include: { user: { select: { id: true, name: true, isActive: true } } } },
      rules: { orderBy: { priority: "asc" } },
    },
  });
  return NextResponse.json({ data: territories });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user || !CREATE_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Solo Dirección/Admin crean territorios" }, { status: 403 });
  }
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const territory = await prisma.territory.create({ data: parsed.data });
  await prisma.auditLog.create({
    data: { userId: session.user.id, action: "CREATE", entity: "Territory", entityId: territory.id, changes: { name: territory.name } },
  }).catch(() => {});

  return NextResponse.json(
    {
      data: territory,
      warning: !parsed.data.forecastManagerId
        ? "Sin forecast manager — recomendado (best practice) para rollups"
        : undefined,
    },
    { status: 201 }
  );
}

// PUT: reemplaza miembros y/o reglas de un territorio { territoryId, members?, rules? }
export async function PUT(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user || !["ADMIN", "DIRECTOR", "GERENTE"].includes(session.user.role)) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }
  const schema = z.object({
    territoryId: z.string().uuid(),
    members: z
      .array(z.object({ userId: z.string().uuid(), accessLevel: z.enum(["VIEW", "EDIT"]).default("VIEW") }))
      .optional(),
    rules: z
      .array(z.object({ priority: z.number().int().min(1).max(1000), conditions: conditionsDslSchema, isActive: z.boolean().default(true) }))
      .optional(),
  });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { territoryId, members, rules } = parsed.data;

  if (members) {
    await prisma.territoryMember.deleteMany({ where: { territoryId } });
    if (members.length > 0) {
      await prisma.territoryMember.createMany({
        data: members.map((m) => ({ territoryId, ...m })),
      });
    }
  }
  if (rules) {
    await prisma.territoryRule.deleteMany({ where: { territoryId } });
    if (rules.length > 0) {
      await prisma.territoryRule.createMany({
        data: rules.map((r) => ({ territoryId, priority: r.priority, conditions: r.conditions as object, isActive: r.isActive })),
      });
    }
  }

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: "UPDATE",
      entity: "Territory",
      entityId: territoryId,
      changes: { members: members?.length, rules: rules?.length },
    },
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
