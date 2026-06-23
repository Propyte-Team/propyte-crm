// Lógica pura del lifecycle del contacto. Sin BD, sin I/O → testeable.
import type { LifecycleStage } from "@prisma/client";

export const LIFECYCLE_ORDER: LifecycleStage[] = [
  "SUSCRIPTOR", "LEAD", "MQL", "SQL", "OPORTUNIDAD", "CLIENTE", "EMBAJADOR",
];

export function stageIndex(stage: LifecycleStage | null | undefined): number {
  if (!stage) return -1;
  return LIFECYCLE_ORDER.indexOf(stage);
}

/** Forward-only: destino debe ser posterior. null (sin etapa) → cualquier etapa es forward. */
export function isForward(
  from: LifecycleStage | null | undefined,
  to: LifecycleStage,
): boolean {
  return stageIndex(to) > stageIndex(from ?? null);
}

/** Mapea una señal de dominio + estado del contacto a la etapa candidata (o null si no aplica). */
export function candidateStageForSignal(
  signal: string,
  contact: { score: number },
  qualifiedThreshold: number,
): LifecycleStage | null {
  switch (signal) {
    case "deal.won":
      return "CLIENTE";
    case "deal.created":
    case "deal.stage_changed":
      return "OPORTUNIDAD";
    case "contact.scored":
      return contact.score >= qualifiedThreshold ? "SQL"
        : contact.score >= Math.ceil(qualifiedThreshold / 2) ? "MQL"
        : null;
    case "whatsapp.replied":
    case "lead.captured":
      return "MQL";
    default:
      return null;
  }
}
