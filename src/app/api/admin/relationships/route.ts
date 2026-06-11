// Registro de relaciones entre módulos (speckit §4) — GET catálogo · POST definir (ADMIN).
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";

const createSchema = z.object({
  name: z.string().min(2).max(80).regex(/^[a-z][a-z0-9_]*$/, "snake_case"),
  fromObject: z.string().min(2),
  toObject: z.string().min(2),
  kind: z.enum(["LOOKUP", "MASTER_DETAIL", "MANY_TO_MANY"]),
  onDelete: z.enum(["SET_NULL", "CASCADE", "RESTRICT"]).default("SET_NULL"),
  relatedListLabel: z.string().min(1).max(120),
  labels: z.array(z.object({ label: z.string().min(1), fromRole: z.string().optional(), toRole: z.string().optional() })).default([]),
  projections: z
    .array(z.object({ sourceFieldApiName: z.string().min(1), displayLabel: z.string().min(1) }))
    .max(5, "Máximo 5 proyecciones (estilo Zoho field-of-lookup)")
    .default([]),
});

export async function GET() {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const relationships = await prisma.relationshipDef.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    include: { labels: true, projections: { orderBy: { order: "asc" } }, _count: { select: { links: true } } },
  });
  return NextResponse.json({ data: relationships });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Solo ADMIN define relaciones" }, { status: 403 });
  }
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { labels, projections, ...data } = parsed.data;

  // Objetos deben existir en el registro; externos solo como destino de LOOKUP (OQ5)
  const objects = await prisma.customObjectDef.findMany({
    where: { apiName: { in: [data.fromObject, data.toObject] } },
  });
  if (objects.length < 2 && data.fromObject !== data.toObject) {
    return NextResponse.json({ error: "fromObject/toObject deben existir en el registro de objetos" }, { status: 422 });
  }
  const toObj = objects.find((o) => o.apiName === data.toObject);
  if (toObj?.isExternal && data.kind !== "LOOKUP") {
    return NextResponse.json({ error: "Objetos externos (Hub) solo admiten LOOKUP read-only" }, { status: 422 });
  }

  const relationship = await prisma.relationshipDef.create({
    data: {
      ...data,
      labels: labels.length ? { create: labels } : undefined,
      projections: projections.length
        ? { create: projections.map((p, i) => ({ ...p, order: (i + 1) * 10 })) }
        : undefined,
    },
    include: { labels: true, projections: true },
  });

  await prisma.auditLog.create({
    data: { userId: session.user.id, action: "CREATE", entity: "RelationshipDef", entityId: relationship.id, changes: { name: relationship.name, kind: relationship.kind } },
  }).catch(() => {});

  return NextResponse.json({ data: relationship }, { status: 201 });
}
