import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { cutoffFromWindow, parseMetricsQuery } from "./route-helpers";

const MANAGE_ROLES = ["ADMIN", "DIRECTOR"];

export async function GET(req: Request) {
  const session = await getServerSession();
  if (!session?.user || !MANAGE_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  const q = parseMetricsQuery(new URL(req.url).searchParams);
  if (!q.ok) return NextResponse.json({ error: "ruleId y window requeridos" }, { status: 400 });
  const cutoff = cutoffFromWindow(q.window, Date.now());

  const rows = await prisma.$queryRaw<{ path: string; n: number }[]>`
    select split_part("dedupeKey", ':', 4) as path, count(distinct "entityId")::int as n
    from propyte_crm.action_queue
    where "ruleId" = ${q.ruleId}
      and (${cutoff}::timestamptz is null or "createdAt" >= ${cutoff})
    group by 1`;
  const totalRows = await prisma.$queryRaw<{ total: number }[]>`
    select count(distinct "entityId")::int as total
    from propyte_crm.action_queue
    where "ruleId" = ${q.ruleId}
      and (${cutoff}::timestamptz is null or "createdAt" >= ${cutoff})`;

  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.path] = r.n;
  return NextResponse.json({ counts, total: totalRows[0]?.total ?? 0, window: q.window });
}
