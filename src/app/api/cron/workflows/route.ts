// Tick del motor de workflows (Anexo §D.1) — agendar en Hostinger CADA MINUTO:
//   curl -s -H "x-cron-secret: $CRON_SECRET" https://crm.propyte.com/api/cron/workflows
// Hace: eventos pendientes → cola de acciones → SLA breaches → enrollments → reglas INACTIVITY.
import { NextRequest, NextResponse } from "next/server";
import { processPendingEvents } from "@/lib/workflows/events";
import { runQueue } from "@/lib/workflows/queue";
import { checkSlaBreaches } from "@/lib/workflows/sla";
import { runEnrollments, runInactivityRules } from "@/lib/workflows/scheduler";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const header = req.headers.get("x-cron-secret")?.trim();
  const query = req.nextUrl.searchParams.get("key")?.trim();
  return header === secret || query === secret;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const startedAt = Date.now();
  const result: Record<string, unknown> = {};

  try {
    result.events = await processPendingEvents(50);
    result.queue = await runQueue(20);
    result.slaBreaches = await checkSlaBreaches(100);
    result.enrollments = await runEnrollments(50);
    result.inactivity = await runInactivityRules(200);
    result.ms = Date.now() - startedAt;
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[cron/workflows] error:", err);
    return NextResponse.json(
      { ok: false, error: String(err instanceof Error ? err.message : err), partial: result },
      { status: 500 }
    );
  }
}
