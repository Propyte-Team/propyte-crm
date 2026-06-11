// Normalización de teléfonos a E.164 — clave de dedup de contactos (Anexo Técnico §A).
// Heurística MX-first: 10 dígitos => +52; tolera el "1" de marcación celular legacy (+521…)
// y el prefijo "whatsapp:" que agrega Twilio.
export function normalizePhoneE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.trim().replace(/^whatsapp:/i, "").replace(/[\s\-().]/g, "");
  if (!s) return null;

  const hasPlus = s.startsWith("+");
  s = s.replace(/\D/g, "");
  if (s.length < 10 || s.length > 15) return null;

  // +521XXXXXXXXXX (13 dígitos) → +52XXXXXXXXXX (legacy celular MX)
  if (s.startsWith("521") && s.length === 13) s = "52" + s.slice(3);

  if (hasPlus) return "+" + s;
  if (s.length === 10) return "+52" + s; // nacional MX
  return "+" + s; // internacional sin + (mejor esfuerzo: 52..., 1..., etc.)
}
