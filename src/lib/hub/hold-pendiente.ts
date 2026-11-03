// #961 — Marca «Pendiente de apartar en el Hub» de una operación (custom.hubHoldPendiente).
// Sin base ni red: lo usan la API (apartado-de-respaldo.ts) y la ficha del contacto.
import type { HubHoldResult } from "@/lib/hub/types";

export interface HoldPendiente {
  desde: string;
  motivo: "sin_configurar" | "mal_configurado" | "sin_respuesta";
  error: string | null;
}

export const HOLD_PENDIENTE_LABEL = "Pendiente de apartar en el Hub";

/** ¿El fallo del hold permite apartar de respaldo? Solo si el Hub no dijo que no. */
export function permiteRespaldo(hold: HubHoldResult): hold is HubHoldResult & { motivo: HoldPendiente["motivo"] } {
  return !hold.ok && (hold.motivo === "sin_configurar" || hold.motivo === "mal_configurado" || hold.motivo === "sin_respuesta");
}

/** Estados del Hub que ya no se pueden apartar (texto libre: «Vendida», «Apartada», «Reservado»…). */
export function estadoOcupado(status: string | null | undefined): boolean {
  const s = (status ?? "").trim().toLowerCase();
  return s.startsWith("vendid") || s.startsWith("apartad") || s.startsWith("reservad");
}

/** Lee la marca de una operación (o null). */
export function holdPendienteDe(custom: unknown): HoldPendiente | null {
  if (!custom || typeof custom !== "object" || Array.isArray(custom)) return null;
  const p = (custom as Record<string, unknown>).hubHoldPendiente;
  if (!p || typeof p !== "object") return null;
  const x = p as Partial<HoldPendiente>;
  return typeof x.desde === "string" ? { desde: x.desde, motivo: x.motivo === "sin_respuesta" || x.motivo === "mal_configurado" ? x.motivo : "sin_configurar", error: x.error ?? null } : null;
}
