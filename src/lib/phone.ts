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

/**
 * Lo que se deja escribir en un campo de teléfono (Mi perfil, #900): solo dígitos y un «+»
 * inicial. Espacios, guiones, puntos y paréntesis no entran, ni al teclear ni al pegar, para que
 * todos los números queden guardados igual. No valida la longitud: eso lo hace el servidor con
 * normalizePhoneE164 al guardar.
 */
export function telefonoSinEspacios(raw: string): string {
  const s = raw.trim();
  const digitos = s.replace(/\D/g, "");
  return s.startsWith("+") ? `+${digitos}` : digitos;
}

/**
 * Cómo se MUESTRA un teléfono ya guardado (fichas técnicas, #898): con espacios para leerlo de
 * un vistazo. Solo presentación; el dato y los enlaces tel:/wa.me siguen pegados.
 *   +529842470103 → +52 984 247 0103   ·   +15551234567 → +1 555 123 4567
 * Cualquier otro formato se devuelve tal cual.
 */
export function telefonoLegible(e164: string | null | undefined): string | null {
  if (!e164) return null;
  const mx = e164.match(/^\+52(\d{3})(\d{3})(\d{4})$/);
  if (mx) return `+52 ${mx[1]} ${mx[2]} ${mx[3]}`;
  const nanp = e164.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  if (nanp) return `+1 ${nanp[1]} ${nanp[2]} ${nanp[3]}`;
  return e164;
}
