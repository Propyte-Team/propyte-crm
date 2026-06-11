// Hashing de PII para Conversions API (speckit #4 §5/PA7) — SHA-256 con normalización
// estándar de plataformas: email lowercase/trim · phone solo dígitos (E.164 sin "+") ·
// nombres lowercase sin acentos. La PII NUNCA sale en claro del servidor.
import { createHash } from "crypto";

type PIIKind = "email" | "phone" | "firstName" | "lastName" | "city" | "country";

function normalize(kind: PIIKind, raw: string): string {
  const s = raw.trim();
  switch (kind) {
    case "email":
      return s.toLowerCase();
    case "phone":
      return s.replace(/\D/g, "");
    default:
      return s
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "");
  }
}

export function hashPII(kind: PIIKind, value: string | null | undefined): string | null {
  if (!value || !value.trim()) return null;
  return createHash("sha256").update(normalize(kind, value), "utf8").digest("hex");
}

// user_data estilo Meta CAPI (em/ph/fn/ln/ct/country) — TikTok lo acepta vía su converter
export function buildHashedUserData(input: {
  email?: string | null;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  city?: string | null;
  country?: string | null;
}): Record<string, string> {
  const out: Record<string, string> = {};
  const em = hashPII("email", input.email);
  const ph = hashPII("phone", input.phone);
  const fn = hashPII("firstName", input.firstName);
  const ln = hashPII("lastName", input.lastName);
  const ct = hashPII("city", input.city);
  const country = hashPII("country", input.country);
  if (em) out.em = em;
  if (ph) out.ph = ph;
  if (fn) out.fn = fn;
  if (ln) out.ln = ln;
  if (ct) out.ct = ct;
  if (country) out.country = country;
  return out;
}
