import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import { upsertGoal } from "@/server/goals";

const SET_ROLES = ["ADMIN", "DIRECTOR", "GERENTE", "TEAM_LEADER"];

function parsePeriod(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})$/.exec(s);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
}

export async function POST(request: NextRequest) {
  const session = await getServerSession();
  if (!session?.user?.id) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!SET_ROLES.includes(session.user.role as string)) {
    return NextResponse.json({ error: "Sin permiso para fijar metas" }, { status: 403 });
  }
  try {
    const body = await request.json();
    const period = typeof body?.period === "string" ? parsePeriod(body.period) : null;
    if (!period) return NextResponse.json({ error: "period inválido (YYYY-MM)" }, { status: 400 });
    if (!body?.scope || !body?.metric || body?.target == null) {
      return NextResponse.json({ error: "scope, metric y target son requeridos" }, { status: 400 });
    }
    const result = await upsertGoal({
      scope: body.scope, userId: body.userId ?? null, teamId: body.teamId ?? null,
      period, metric: body.metric, target: Number(body.target), currency: body.currency ?? null,
      createdById: session.user.id,
    });
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ data: result.goal }, { status: 201 });
  } catch (e) {
    console.error("[POST /api/goals]", e);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
