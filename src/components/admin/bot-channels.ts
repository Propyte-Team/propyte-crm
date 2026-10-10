// Canales en que contesta el bot (configuración global) — módulo PURO (2026-10-10).
//
// La tarjeta del panel promete "Encendido y canales", pero la pestaña Bot solo dejaba prender o
// apagar el bot: `enabledChannels` se guardaba tal cual venía de la base y no había forma de
// cambiarlo desde el panel. Por eso Instagram y Messenger de las cuentas sin marca nunca
// contestaban solos (el valor de fábrica es solo WhatsApp). Las marcas no predeterminadas tienen
// sus propios canales (Marcas del agente); esto aplica a todas las cuentas sin marca.

export const BOT_CHANNELS = [
  { value: "WHATSAPP", label: "WhatsApp" },
  { value: "INSTAGRAM", label: "Instagram" },
  { value: "MESSENGER", label: "Messenger" },
] as const;

/** Prende o apaga un canal sin tocar los demás (incluidos los que la pantalla no muestra, como SMS). */
export function toggleBotChannel(current: readonly string[], channel: string, on: boolean): string[] {
  if (on) return current.includes(channel) ? [...current] : [...current, channel];
  return current.filter((c) => c !== channel);
}
