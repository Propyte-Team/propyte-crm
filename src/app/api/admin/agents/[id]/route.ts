// Toggle/edición ligera de un agente + sus últimas corridas.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";

const MANAGE_ROLES = ["ADMIN", "DIRECTOR"];

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const agent = await prisma.agentDef.findUnique({
    where: { id: params.id },
    include: {
      systemUser: { select: { name: true, role: true } },
      runs: { orderBy: { startedAt: "desc" }, take: 10 },
    },
  });
  if (!agent) return NextResponse.json({ error: "No existe" }, { status: 404 });
  return NextResponse.json({ data: agent });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession();
  if (!session?.user || !MANAGE_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Solo Dirección/Admin" }, { status: 403 });
  }
  const schema = z.object({
    isActive: z.boolean().optional(),
    autonomyLevel: z.enum(["L0", "L1", "L2", "L3"]).optional(),
    goal: z.string().min(10).max(2000).optional(),
  });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const agent = await prisma.agentDef.update({ where: { id: params.id }, data: parsed.data });
  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: "UPDATE",
      entity: "AgentDef",
      entityId: params.id,
      changes: JSON.parse(JSON.stringify(parsed.data)),
    },
  }).catch(() => {});
  return NextResponse.json({ data: agent });
}
