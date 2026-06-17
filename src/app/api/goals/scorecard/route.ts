import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import { getScorecard } from "@/server/goals";

const OWN_ROLES = ["ASESOR", "ASESOR_SR", "ASESOR_JR", "BROKER", "HOSTESS"];

function parsePeriod(s: string | null): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})$/.exec(s);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
}

export async function GET(request: NextRequest) {
  const session = await getServerSession();
  if (!session?.user?.id) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const period = parsePeriod(request.nextUrl.searchParams.get("period"));
  if (!period) return NextResponse.json({ error: "period requerido (YYYY-MM)" }, { status: 400 });

  let userId = request.nextUrl.searchParams.get("userId") ?? undefined;
  const teamId = request.nextUrl.searchParams.get("teamId") ?? undefined;

  if (OWN_ROLES.includes(session.user.role as string)) {
    userId = session.user.id;
  }

  const data = await getScorecard({ period, userId, teamId });
  return NextResponse.json({ data });
}
