import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import { upsertGoal, metaDentroDeAlcance } from "@/server/goals";
import {
  GOAL_METRICS,
  GOAL_SCOPES,
  puedeFijarMetas,
  puedeFijarMetasEmpresa,
  type GoalMetricValue,
  type GoalScopeValue,
} from "@/lib/rbac/goal-scope";

function parsePeriod(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})$/.exec(s);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
}

const SIN_PERMISO = "Sin permiso para fijar esa meta";

/**
 * POST /api/goals — crea o actualiza una meta.
 *
 * #895: antes bastaba el rol (ADMIN, DIRECTOR, GERENTE, TEAM_LEADER) para fijar metas a
 * cualquiera, incluida la empresa. Ahora la empresa es solo de ADMIN y DIRECTOR, y las de
 * personas y equipos tienen que caer dentro del alcance del rol (`lib/rbac/goal-scope.ts`).
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession();
  if (!session?.user?.id) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const role = session.user.role as string;
  if (!puedeFijarMetas(role)) {
    return NextResponse.json({ error: "Sin permiso para fijar metas" }, { status: 403 });
  }
  try {
    const body = await request.json();
    const period = typeof body?.period === "string" ? parsePeriod(body.period) : null;
    if (!period) return NextResponse.json({ error: "period inválido (YYYY-MM)" }, { status: 400 });
    if (!body?.scope || !body?.metric || body?.target == null) {
      return NextResponse.json({ error: "scope, metric y target son requeridos" }, { status: 400 });
    }
    // Antes iban crudos a Prisma: un valor fuera del enum salía como 500 «error interno».
    if (!(GOAL_SCOPES as readonly string[]).includes(body.scope)) {
      return NextResponse.json({ error: "scope inválido (USER | TEAM | COMPANY)" }, { status: 400 });
    }
    if (!(GOAL_METRICS as readonly string[]).includes(body.metric)) {
      return NextResponse.json({ error: "metric inválida" }, { status: 400 });
    }
    if (body.currency != null && body.currency !== "MXN" && body.currency !== "USD") {
      return NextResponse.json({ error: "currency inválida (MXN | USD)" }, { status: 400 });
    }
    const target = Number(body.target);
    if (!Number.isFinite(target)) {
      return NextResponse.json({ error: "target debe ser un número" }, { status: 400 });
    }
    const scope = body.scope as GoalScopeValue;
    const userId = typeof body.userId === "string" ? body.userId : null;
    const teamId = typeof body.teamId === "string" ? body.teamId : null;

    if (scope === "COMPANY" && !puedeFijarMetasEmpresa(role)) {
      return NextResponse.json({ error: "Solo dirección fija las metas de la empresa" }, { status: 403 });
    }
    const user = { id: session.user.id, role, plaza: session.user.plaza };
    if (scope !== "COMPANY" && (userId || teamId) && !(await metaDentroDeAlcance(user, { scope, userId, teamId }))) {
      return NextResponse.json({ error: SIN_PERMISO }, { status: 403 });
    }

    const result = await upsertGoal({
      scope, userId, teamId,
      period, metric: body.metric as GoalMetricValue, target, currency: body.currency ?? null,
      createdById: session.user.id,
    });
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ data: result.goal }, { status: 201 });
  } catch (e) {
    console.error("[POST /api/goals]", e);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
