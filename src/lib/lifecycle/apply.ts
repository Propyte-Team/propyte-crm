import prisma from "@/lib/db";
import type { LifecycleStage } from "@prisma/client";
import { emitEvent } from "@/lib/workflows/events";
import { isForward, candidateStageForSignal } from "./transitions";

export interface ApplyArgs {
  contactId: string;
  from: LifecycleStage | null | undefined;
  to: LifecycleStage;
  actorUserId?: string | null;
  auto: boolean; // true = auto (forward-only); false = override manual (cualquier dirección)
}

export interface ApplyResult { applied: boolean; note?: string }

export async function applyLifecycleTransition(args: ApplyArgs): Promise<ApplyResult> {
  const { contactId, from, to, actorUserId, auto } = args;
  if (from === to) return { applied: false, note: "Sin cambio" };
  if (auto && !isForward(from, to)) return { applied: false, note: "Auto no retrocede" };

  await prisma.contact.update({ where: { id: contactId }, data: { lifecycleStage: to } });

  if (actorUserId) {
    await prisma.activity.create({
      data: {
        contactId,
        userId: actorUserId,
        activityType: "NOTE",
        subject: `Lifecycle: ${from ?? "—"} → ${to}`,
        description: auto ? "Avance automático del ciclo de vida" : "Cambio manual de etapa",
        status: "COMPLETADA",
      },
    });
  }

  await emitEvent("contact.lifecycle_changed", "contact", contactId, {
    fromStage: from ?? null, toStage: to, auto,
  });

  return { applied: true };
}

/** Engancha auto-avance a un evento de dominio. Devuelve la etapa nueva si avanzó. */
export async function maybeAdvanceLifecycleFromEvent(
  signal: string,
  contact: { id: string; score: number; contactType: string; lifecycleStage: LifecycleStage | null },
  qualifiedThreshold: number,
): Promise<LifecycleStage | null> {
  // Solo compradores/inversionistas tienen lifecycle.
  if (!["COMPRADOR", "INVERSIONISTA"].includes(contact.contactType)) return null;
  const candidate = candidateStageForSignal(signal, contact, qualifiedThreshold);
  if (!candidate) return null;
  const res = await applyLifecycleTransition({
    contactId: contact.id, from: contact.lifecycleStage, to: candidate, auto: true,
  });
  return res.applied ? candidate : null;
}
