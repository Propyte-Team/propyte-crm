// PATCH equipo · POST agrega miembro · DELETE saca miembro (historial leftAt, nunca borra).
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";

const MANAGE_ROLES = ["ADMIN", "DIRECTOR", "GERENTE"];

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession();
  if (!session?.user || !MANAGE_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }
  const schema = z.object({
    name: z.string().min(2).max(120).optional(),
    leaderId: z.string().uuid().nullable().optional(),
    forecastManagerId: z.string().uuid().nullable().optional(),
    isActive: z.boolean().optional(),
  });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const team = await prisma.team.update({ where: { id: params.id }, data: parsed.data });
  return NextResponse.json({ data: team });
}

// Agregar miembro (mueve de equipo = DELETE en uno + POST en otro; historial intacto)
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession();
  if (!session?.user || !MANAGE_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }
  const schema = z.object({
    userId: z.string().uuid(),
    roleInTeam: z.enum(["LEADER", "SENIOR", "JUNIOR", "HOSTESS"]).default("JUNIOR"),
  });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const active = await prisma.teamMember.findFirst({
    where: { teamId: params.id, userId: parsed.data.userId, leftAt: null },
  });
  if (active) return NextResponse.json({ error: "Ya es miembro activo" }, { status: 409 });

  const member = await prisma.teamMember.create({
    data: { teamId: params.id, ...parsed.data },
    include: { user: { select: { id: true, name: true } } },
  });
  return NextResponse.json({ data: member }, { status: 201 });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession();
  if (!session?.user || !MANAGE_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }
  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId) return NextResponse.json({ error: "Falta userId" }, { status: 400 });

  await prisma.teamMember.updateMany({
    where: { teamId: params.id, userId, leftAt: null },
    data: { leftAt: new Date() },
  });
  return NextResponse.json({ ok: true });
}
