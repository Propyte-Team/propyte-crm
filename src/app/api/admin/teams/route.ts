// CRUD de equipos (speckit Personalización §2.3) — ADMIN/DIRECTOR crean; GERENTE asigna.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";

const CREATE_ROLES = ["ADMIN", "DIRECTOR"];

const createSchema = z.object({
  name: z.string().min(2).max(120),
  plaza: z.enum(["PDC", "TULUM", "MERIDA"]),
  leaderId: z.string().uuid().optional(),
  parentTeamId: z.string().uuid().optional(),
  forecastManagerId: z.string().uuid().optional(),
});

export async function GET() {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const teams = await prisma.team.findMany({
    where: { deletedAt: null },
    orderBy: { name: "asc" },
    include: {
      leader: { select: { id: true, name: true } },
      forecastManager: { select: { id: true, name: true } },
      parentTeam: { select: { id: true, name: true } },
      members: {
        where: { leftAt: null },
        include: { user: { select: { id: true, name: true, role: true, isActive: true } } },
      },
    },
  });
  return NextResponse.json({ data: teams });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user || !CREATE_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Solo Dirección/Admin crean equipos" }, { status: 403 });
  }
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const team = await prisma.team.create({ data: parsed.data });

  // Warning best-practice SF (OQ7): forecast manager opcional pero recomendado
  const warning = !parsed.data.forecastManagerId
    ? "Sin forecast manager asignado — recomendado para no romper rollups de forecast"
    : undefined;

  await prisma.auditLog.create({
    data: { userId: session.user.id, action: "CREATE", entity: "Team", entityId: team.id, changes: { name: team.name } },
  }).catch(() => {});

  return NextResponse.json({ data: team, warning }, { status: 201 });
}
