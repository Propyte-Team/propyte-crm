// SlaEngine (Anexo Técnico §D.2/§D.7) — timers FIRST_TOUCH/RETRY/ORPHAN.
// Se cumplen con el primer toque saliente; el cron marca breaches y escala.
import prisma from "@/lib/db";

async function defaultPolicy() {
  return prisma.slaPolicy.findFirst({ where: { isDefault: true, isActive: true } });
}

export async function createSlaTimer(
  contactId: string,
  type: "FIRST_TOUCH" | "RETRY" | "ORPHAN",
  dealId?: string
): Promise<void> {
  const policy = await defaultPolicy();
  const minutes =
    type === "FIRST_TOUCH" ? policy?.firstTouchMinutes ?? 5
    : type === "RETRY" ? policy?.retryMinutes ?? 30
    : (policy?.orphanHours ?? 24) * 60;

  // No duplicar un timer RUNNING del mismo tipo para el mismo contacto
  const existing = await prisma.slaTimer.findFirst({
    where: { contactId, type, status: "RUNNING" },
    select: { id: true },
  });
  if (existing) return;

  await prisma.slaTimer.create({
    data: {
      contactId,
      dealId: dealId ?? null,
      policyId: policy?.id ?? null,
      type,
      dueAt: new Date(Date.now() + minutes * 60_000),
    },
  });
}

// Llamar cuando hay un toque saliente real (llamada/WhatsApp/email del asesor o bot)
// o cuando el contacto responde (el contacto fue atendido).
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
