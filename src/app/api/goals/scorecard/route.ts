import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import { getScorecard } from "@/server/goals";
import { filtroScorecard, metasVisiblesWhere } from "@/lib/rbac/goal-scope";

function parsePeriod(s: string | null): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})$/.exec(s);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
}

/**
 * GET /api/goals/scorecard?period=YYYY-MM[&scope=COMPANY|USER|TEAM][&userId=][&teamId=]
 *
 * #895: lo que pide la URL se SUMA al alcance del rol (`lib/rbac/goal-scope.ts`), no lo
 * reemplaza. Pedir a alguien fuera de alcance da lista vacía. Sin filtros = «mi avance»: mis
 * metas + las de la empresa.
 */
export async function GET(request: NextRequest) {
  const session = await getServerSession();
  if (!session?.user?.id) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const sp = request.nextUrl.searchParams;
  const period = parsePeriod(sp.get("period"));
  if (!period) return NextResponse.json({ error: "period requerido (YYYY-MM)" }, { status: 400 });

  const user = { id: session.user.id, role: session.user.role as string, plaza: session.user.plaza };
  const pedido = filtroScorecard(user, {
    scope: sp.get("scope"),
    userId: sp.get("userId"),
    teamId: sp.get("teamId"),
  });
  if ("error" in pedido) return NextResponse.json({ error: pedido.error }, { status: 400 });

  const data = await getScorecard({ period, filtros: [metasVisiblesWhere(user), pedido.where] });
  return NextResponse.json({ data });
}
