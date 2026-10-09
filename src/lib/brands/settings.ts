// Ajustes del agente por marca — módulo PURO (2026-10-09, spec marcas-agente §3.2).
import type { Brand } from "@prisma/client";

/** Canales en que contesta el agente de la marca; null = hereda BotConfig.enabledChannels.
 *  Un JSON inválido también hereda: nunca debe tumbar al agente. */
export function brandEnabledChannels(brand: Pick<Brand, "enabledChannels">): string[] | null {
  const v = brand.enabledChannels as unknown;
  return Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : null;
}
