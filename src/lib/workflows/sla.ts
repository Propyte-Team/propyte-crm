// SlaEngine (Anexo Técnico §D.2/§D.7) — timers FIRST_TOUCH/RETRY/ORPHAN.
// Política elegida por segmento; vencimiento por minutos hábiles (excepto ORPHAN = wall-clock).
import prisma from "@/lib/db";
import { selectSlaPolicy } from "./sla-select";
import { computeDueAt, type BusinessHours } from "./business-hours";

// Contexto mínimo para el DSL de condiciones (contacto + attribution + plaza del asesor).
async function loadSlaContext(contactId: string): Promise<Record<string, unknown>> {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    include: { adAttribution: true, assignedTo: { select: { plaza: true } } },
  });
  return {
    contact,
    adAttribution: (contact as { adAttribution?: unknown } | null)?.adAttribution ?? null,
    plaza: (contact as { assignedTo?: { plaza?: unknown } } | null)?.assignedTo?.plaza ?? null,
  };
}

export async function createSlaTimer(
  contactId: string,
  type: "FIRST_TOUCH" | "RETRY" | "ORPHAN",
  dealId?: string
): Promise<void> {
  // No duplicar un timer RUNNING del mismo tipo para el mismo contacto
  const existing = await prisma.slaTimer.findFirst({
    where: { contactId, type, status: "RUNNING" },
    select: { id: true },
  });
  if (existing) return;

  const [ctx, policies] = await Promise.all([
    loadSlaContext(contactId),
    prisma.slaPolicy.findMany({ where: { isActive: true } }),
  ]);
  const policy = selectSlaPolicy(policies, ctx);

  const minutes =
    type === "FIRST_TOUCH" ? policy?.firstTouchMinutes ?? 5
    : type === "RETRY" ? policy?.retryMinutes ?? 30
    : (policy?.orphanHours ?? 24) * 60;

  const bh = type === "ORPHAN" ? null : ((policy?.businessHours as unknown as BusinessHours) ?? null);
  const dueAt = computeDueAt(new Date(), minutes, bh);

  await prisma.slaTimer.create({
    data: { contactId, dealId: dealId ?? null, policyId: policy?.id ?? null, type, dueAt },
  });
}

// Llamar SOLO cuando hay un toque SALIENTE real: llamada, WhatsApp, email o DM del
// asesor o del bot. Nunca desde un mensaje entrante.
//
// #702: hasta 2026-09-05 la segunda mitad de este comentario decía "o cuando el contacto
// responde (el contacto fue atendido)". Esa frase supone que nosotros hablamos primero,
// y es falsa para todo lead de IG/Messenger/WhatsApp, que es quien inicia. Tratar su
// primer mensaje como "fue atendido" cerraba el reloj que mide si lo atendimos: los 8
// únicos FIRST_TOUCH en MET de la historia se cumplieron entre 1.53 s y 1.87 s. Si nos
// escribió él primero, el toque que cuenta es el nuestro, y ese ya llama aquí solo.
export async function meetSlaTimers(contactId: string): Promise<number> {
  const res = await prisma.slaTimer.updateMany({
    where: { contactId, status: "RUNNING" },
    data: { status: "MET", metAt: new Date() },
  });
  if (res.count > 0) {
    await prisma.contact.update({
      where: { id: contactId },
      data: { lastActivityAt: new Date() },
    }).catch(() => {});
  }
  return res.count;
}

// Cron: marca BREACHED los vencidos, encadena RETRY tras FIRST_TOUCH y emite sla.breach.
export async function checkSlaBreaches(limit = 100): Promise<number> {
  const due = await prisma.slaTimer.findMany({
    where: { status: "RUNNING", dueAt: { lte: new Date() } },
    take: limit,
  });

  const { emitEvent } = await import("./events");
  for (const timer of due) {
    await prisma.slaTimer.update({
      where: { id: timer.id },
      data: { status: "BREACHED", breachedAt: new Date() },
    });
    await emitEvent("sla.breach", "contact", timer.contactId, {
      timerType: timer.type,
      dueAt: timer.dueAt.toISOString(),
    });
    // Cadena: FIRST_TOUCH vencido → arranca RETRY (reintento 30 min, P2)
    if (timer.type === "FIRST_TOUCH") {
      await createSlaTimer(timer.contactId, "RETRY", timer.dealId ?? undefined);
    }
  }
  return due.length;
}
