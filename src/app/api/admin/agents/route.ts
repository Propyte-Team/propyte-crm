// CRUD de agentes (speckit #4 §2) — ADMIN/DIRECTOR. GET incluye métricas de runs.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { AGENT_TOOLS } from "@/lib/agents/tools";

const MANAGE_ROLES = ["ADMIN", "DIRECTOR"];

const upsertSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(2).max(80),
  goal: z.string().min(10).max(2000),
  systemUserId: z.string().uuid(),
  autonomyLevel: z.enum(["L0", "L1", "L2"]).default("L2"),
  allowedTools: z.array(z.string()).min(1),
  trigger: z.record(z.unknown()).default({}),
  limits: z.record(z.unknown()).default({}),
  isActive: z.boolean().default(false),
});

export async function GET() {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const agents = await prisma.agentDef.findMany({
    where: { deletedAt: null },
    orderBy: { name: "asc" },
    include: {
      systemUser: { select: { id: true, name: true, role: true } },
      _count: { select: { runs: true } },
      runs: { orderBy: { startedAt: "desc" }, take: 1, select: { status: true, startedAt: true } },
    },
  });
  return NextResponse.json({
    data: agents,
    availableTools: AGENT_TOOLS.map((t) => ({ name: t.name, description: t.description })),
  });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user || !MANAGE_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Solo Dirección/Admin gestionan agentes" }, { status: 403 });
  }
  const parsed = upsertSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const validTools = new Set(AGENT_TOOLS.map((t) => t.name));
  const invalid = parsed.data.allowedTools.filter((t) => !validTools.has(t));
  if (invalid.length > 0) {
    return NextResponse.json({ error: `Tools inexistentes: ${invalid.join(", ")}` }, { status: 422 });
  }

  const { id, ...data } = parsed.data;
  const agent = id
    ? await prisma.agentDef.update({ where: { id }, data: data as never })
    : await prisma.agentDef.create({ data: data as never });

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: id ? "UPDATE" : "CREATE",
      entity: "AgentDef",
      entityId: agent.id,
      changes: { name: agent.name, autonomyLevel: agent.autonomyLevel, isActive: agent.isActive },
    },
  }).catch(() => {});

  return NextResponse.json({ data: agent }, { status: id ? 200 : 201 });
}
