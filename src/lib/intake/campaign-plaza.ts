import type { Plaza } from "@prisma/client";

// ============================================================
// Plaza objetivo de un lead, derivada de su marca de campaña/canal.
//
// Mapa acordado (Luis, 2026-09-03; matizado en #729, 2026-09-05):
//   · Nativa Tulum         -> TULUM
//   · Yaxnah / Mérida      -> MERIDA (vivienda popular; se activa al entrar esa marca)
//   · SIN una sola señal   -> null   (el lead cae al Pond, no se le fuerza una plaza)
//   · con señal, sin match -> PDC    (default deliberado: campañas Propyte de Playa)
//
// #729: la distinción entre las dos últimas es el punto. "Sin señal" no es lo mismo que
// "señal que no coincide". El que escribe por WhatsApp directo llega sin campaña, sin
// anuncio y sin conector: de ese no sabemos nada y forzarle PDC lo rutea en silencio a un
// asesor de Playa aunque preguntara por Nativa Tulum. En cambio una campaña de Facebook
// con nombre propio SÍ es una señal, y si no menciona Nativa ni Yaxnah es de Playa: las
// campañas Propyte no llevan token de plaza en el nombre, así que mandarlas al Pond
// dejaría sin asignar la fuente principal de leads.
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
 * (nombre de campaña, anuncio, adset, conector…), o `null` si no llegó ninguna.
 * `null` es deliberado: el lead cae al Pond en vez de recibir una plaza inventada.
 */
export function resolveTargetPlaza(signals: Array<string | null | undefined>): Plaza | null {
  const hay = signals.filter(Boolean).join(" ").trim().toLowerCase();
  if (!hay) return null;
  if (MERIDA_SIGNALS.some((s) => hay.includes(s))) return "MERIDA";
  if (TULUM_SIGNALS.some((s) => hay.includes(s))) return "TULUM";
  return "PDC";
}
