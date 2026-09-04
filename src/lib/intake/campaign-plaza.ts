import type { Plaza } from "@prisma/client";

// ============================================================
// Plaza objetivo de un lead, derivada de su marca de campaña/canal.
//
// Mapa acordado (Luis, 2026-09-03):
//   · Nativa Tulum        -> TULUM
//   · todo lo demás       -> PDC   (campañas Propyte de Playa del Carmen)
//   · Yaxnah (vivienda popular, Mérida) usará MERIDA cuando entre esa marca.
//
// La señal puede venir del nombre de la campaña/anuncio/adset (Facebook Lead Ads)
// o del nombre del conector (DM de Instagram/Messenger: "IG - Nativa", "DM Nativa").
//
// ⚠️ Para que un lead de Nativa se detecte solo, su campaña o conector DEBE
// contener "Nativa" o "Tulum" en el nombre. Los conectores de Nativa ya lo llevan;
// las campañas de Facebook de Nativa hay que nombrarlas con esa convención.
// ============================================================

const TULUM_SIGNALS = ["nativa", "tulum"];

// Reservado para la marca Yaxnah (Mérida). Aún sin campañas; se activa al entrar.
const MERIDA_SIGNALS = ["yaxnah", "merida", "mérida", "caucel"];

/**
 * Devuelve la plaza objetivo a partir de las señales disponibles del lead
 * (nombre de campaña, anuncio, adset, conector…). Default: PDC.
 */
export function resolveTargetPlaza(signals: Array<string | null | undefined>): Plaza {
  const hay = signals.filter(Boolean).join(" ").toLowerCase();
  if (MERIDA_SIGNALS.some((s) => hay.includes(s))) return "MERIDA";
  if (TULUM_SIGNALS.some((s) => hay.includes(s))) return "TULUM";
  return "PDC";
}
