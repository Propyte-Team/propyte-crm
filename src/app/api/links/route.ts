// Vínculos entre records (puente genérico RecordLink, speckit §4.2-4.3).
// GET ?object=&id= (ambas direcciones, nombres resueltos) · POST crear · DELETE ?id=.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";

async function resolveNames(object: string, ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (ids.length === 0) return map;
  try {
    if (object === "contact") {
      const rows = await prisma.contact.findMany({
        where: { id: { in: ids } },
        select: { id: true, firstName: true, lastName: true },
      });
      rows.forEach((r) => map.set(r.id, `${r.firstName} ${r.lastName}`));
    } else if (object === "deal") {
      const rows = await prisma.deal.findMany({
        where: { id: { in: ids } },
        select: { id: true, contact: { select: { firstName: true, lastName: true } }, estimatedValue: true },
      });
      rows.forEach((r) => map.set(r.id, `${r.contact.firstName} ${r.contact.lastName} — $${Number(r.estimatedValue).toLocaleString("es-MX")}`));
    } else if (object === "user") {
      const rows = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
      rows.forEach((r) => map.set(r.id, r.name));
    } else {
      const rows = await prisma.customRecord.findMany({
        where: { id: { in: ids } },
        select: { id: true, recordName: true },
      });
      rows.forEach((r) => map.set(r.id, r.recordName));
    }
  } catch { /* nombres faltantes se muestran como id */ }
  return map;
}

export async function GET(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const object = req.nextUrl.searchParams.get("object");
  const id = req.nextUrl.searchParams.get("id");
  if (!object || !id) return NextResponse.json({ error: "Faltan object/id" }, { status: 400 });

  const links = await prisma.recordLink.findMany({
    where: { OR: [{ fromObject: object, fromId: id }, { toObject: object, toId: id }] },
    include: { relationship: { select: { name: true, relatedListLabel: true } }, label: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  // Resolver nombres del "otro lado" de cada vínculo
  const byObject = new Map<string, string[]>();
  for (const l of links) {
    const otherObj = l.fromObject === object && l.fromId === id ? l.toObject : l.fromObject;
    const otherId = l.fromObject === object && l.fromId === id ? l.toId : l.fromId;
    byObject.set(otherObj, [...(byObject.get(otherObj) ?? []), otherId]);
  }
  const names = new Map<string, Map<string, string>>();
  for (const [obj, ids] of byObject) names.set(obj, await resolveNames(obj, ids));

  return NextResponse.json({
    data: links.map((l) => {
      const isFrom = l.fromObject === object && l.fromId === id;
      const otherObj = isFrom ? l.toObject : l.fromObject;
      const otherId = isFrom ? l.toId : l.fromId;
      return {
        id: l.id,
        relationship: l.relationship.name,
        relatedListLabel: l.relationship.relatedListLabel,
        label: l.label?.label ?? null,
        role: isFrom ? l.label?.toRole ?? null : l.label?.fromRole ?? null,
        otherObject: otherObj,
        otherId,
        otherName: names.get(otherObj)?.get(otherId) ?? otherId,
        createdAt: l.createdAt,
      };
    }),
  });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const schema = z.object({
    relationshipId: z.string().uuid(),
    fromId: z.string().min(1),
    toId: z.string().min(1),
    labelId: z.string().uuid().optional(),
  });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const rel = await prisma.relationshipDef.findUnique({ where: { id: parsed.data.relationshipId } });
  if (!rel || !rel.isActive) return NextResponse.json({ error: "Relación inexistente" }, { status: 404 });

  if (!rel.allowMultiple) {
    const existing = await prisma.recordLink.findFirst({
      where: { relationshipId: rel.id, fromId: parsed.data.fromId },
    });
    if (existing) return NextResponse.json({ error: "La relación no admite múltiples vínculos" }, { status: 409 });
  }

  try {
    const link = await prisma.recordLink.create({
      data: {
        relationshipId: rel.id,
        fromObject: rel.fromObject,
        fromId: parsed.data.fromId,
        toObject: rel.toObject,
        toId: parsed.data.toId,
        labelId: parsed.data.labelId,
        createdById: session.user.id,
      },
    });
    return NextResponse.json({ data: link }, { status: 201 });
  } catch (err: unknown) {
    if (typeof err === "object" && err && (err as { code?: string }).code === "P2002") {
      return NextResponse.json({ error: "Vínculo ya existe" }, { status: 409 });
    }
    throw err;
  }
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Falta id" }, { status: 400 });
  await prisma.recordLink.delete({ where: { id } }).catch(() => {});
  return NextResponse.json({ ok: true });
}
