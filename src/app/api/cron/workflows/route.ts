// Tick del motor de workflows (Anexo §D.1) — agendar en Hostinger CADA MINUTO:
//   curl -s -H "x-cron-secret: $CRON_SECRET" https://crm.propyte.com/api/cron/workflows
// Hace: eventos pendientes → cola de acciones → SLA breaches → enrollments → reglas INACTIVITY.
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { processPendingEvents, emitEvent } from "@/lib/workflows/events";
import { runQueue } from "@/lib/workflows/queue";
import { checkSlaBreaches } from "@/lib/workflows/sla";
import { runEnrollments, runInactivityRules } from "@/lib/workflows/scheduler";

// Parcialidades vencidas → VENCIDA + payment.overdue (WF6). Defensivo: si la tabla
// F6 aún no está migrada, regresa 0 sin romper el tick.
async function checkOverduePayments(): Promise<number> {
  try {
    const overdue = await prisma.paymentSchedule.findMany({
      where: { status: "PENDIENTE", dueDate: { lte: new Date() } },
      take: 100,
      include: { plan: { include: { quote: { select: { dealId: true } } } } },
    });
    for (const sched of overdue) {
      await prisma.paymentSchedule.update({
        where: { id: sched.id },
        data: { status: "VENCIDA" },
      });
      await emitEvent("payment.overdue", "deal", sched.plan.quote.dealId, {
        scheduleId: sched.id,
        number: sched.number,
        amount: String(sched.amount),
        dueDate: sched.dueDate.toISOString(),
      });
    }
    return overdue.length;
  } catch {
    return 0; // tabla F6 sin migrar todavía
  }
}

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
    result.overduePayments = await checkOverduePayments();
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
