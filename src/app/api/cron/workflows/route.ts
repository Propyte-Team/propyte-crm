// Tick del motor de workflows (Anexo §D.1) — agendar en Hostinger CADA MINUTO:
//   curl -s -H "x-cron-secret: $CRON_SECRET" https://crm.propyte.com/api/cron/workflows
// Hace: eventos pendientes → cola de acciones → SLA breaches → enrollments → reglas INACTIVITY.
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { processPendingEvents, emitEvent } from "@/lib/workflows/events";
import { runQueue } from "@/lib/workflows/queue";
import { checkSlaBreaches } from "@/lib/workflows/sla";
import { runEnrollments, runInactivityRules } from "@/lib/workflows/scheduler";

// CAPI dispatcher con guarda (tablas C123 pueden no estar migradas aún)
async function processPendingConversionsSafe() {
  try {
    const { processPendingConversions } = await import("@/lib/capi/dispatch");
    return await processPendingConversions(20);
  } catch {
    return { sent: 0, partial: 0, failed: 0 };
  }
}

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

/**
 * Las siete etapas del tick, cada una con su nombre y su llamada.
 *
 * Están en una lista y no encadenadas en el cuerpo porque ANTES compartían un solo
 * `try`: si la primera tropezaba, las seis siguientes no llegaban a correr. Entre ellas
 * las que marcan los SLA vencidos y las que disparan los seguimientos programados, o sea
 * que el tiempo dejaba de pasar para todo lo que depende del reloj — y desde fuera se veía
 * igual que un día tranquilo.
 *
 * NO son independientes en el sentido de que el orden dé igual: los eventos alimentan la
 * cola, y por eso se recorren en secuencia. Lo que cambia es que el fallo de una ya no
 * cancela a las demás. Una etapa que dependa de datos que la anterior no produjo hará
 * menos trabajo, que es estrictamente mejor que no hacer ninguno.
 */
const ETAPAS: ReadonlyArray<{ nombre: string; correr: () => Promise<unknown> }> = [
  { nombre: "events", correr: () => processPendingEvents(50) },
  { nombre: "queue", correr: () => runQueue(20) },
  { nombre: "slaBreaches", correr: () => checkSlaBreaches(100) },
  { nombre: "enrollments", correr: () => runEnrollments(50) },
  { nombre: "inactivity", correr: () => runInactivityRules(200) },
  { nombre: "overduePayments", correr: () => checkOverduePayments() },
  { nombre: "conversions", correr: () => processPendingConversionsSafe() },
];

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const startedAt = Date.now();
  const result: Record<string, unknown> = {};
  const fallos: Array<{ etapa: string; error: string; ms: number }> = [];

  for (const { nombre, correr } of ETAPAS) {
    const t0 = Date.now();
    try {
      result[nombre] = await correr();
    } catch (err) {
      // Cada etapa se reporta con su nombre. Un «el tick falló» sin decir cuál de las
      // siete obliga a reproducir el minuto entero para saber por dónde empezar.
      console.error(`[cron/workflows] etapa ${nombre}:`, err);
      fallos.push({
        etapa: nombre,
        error: String(err instanceof Error ? err.message : err).slice(0, 500),
        ms: Date.now() - t0,
      });
    }
  }

  result.ms = Date.now() - startedAt;

  /**
   * 500 en cuanto UNA etapa falle, aunque las otras seis hayan ido bien.
   *
   * Un 200 con los fallos escondidos en el cuerpo es peor que el bug que se está
   * arreglando: cualquier monitor externo mira el status, y este endpoint corre cada
   * minuto sin que nadie lea su respuesta. El cuerpo lleva TODO —lo que sí corrió y lo
   * que no— para que el status no sea el único dato disponible.
   */
  if (fallos.length > 0) {
    return NextResponse.json({ ok: false, fallos, ...result }, { status: 500 });
  }
  return NextResponse.json({ ok: true, ...result });
}
