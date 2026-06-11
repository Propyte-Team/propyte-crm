// Gobernanza del editor de campos (speckit §3.6, PC2) — funciones PURAS.
// apiName: inmutable, snake_case, prefijo del objeto, no reservados.
const RESERVED_SUFFIXES = new Set([
  "id", "custom", "created_at", "updated_at", "deleted_at",
]);

export interface ApiNameCheck {
  ok: boolean;
  reason?: string;
}

export function validateApiName(objectApiName: string, apiName: string): ApiNameCheck {
  const prefix = `${objectApiName}_`;
  if (!apiName.startsWith(prefix)) {
    return { ok: false, reason: `Debe iniciar con "${prefix}" (convención <objeto>_<snake>)` };
  }
  const rest = apiName.slice(prefix.length);
  if (!/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/.test(rest)) {
    return { ok: false, reason: "snake_case en minúsculas (ej. contact_referido_por)" };
  }
  if (RESERVED_SUFFIXES.has(rest)) {
    return { ok: false, reason: `"${rest}" es un nombre reservado` };
  }
  if (apiName.length > 60) {
    return { ok: false, reason: "Máximo 60 caracteres" };
  }
  return { ok: true };
}

// Detector de duplicados semánticos: solapamiento de tokens en apiName/label.
// Devuelve los campos existentes que comparten ≥1 token significativo.
const STOPWORDS = new Set(["de", "del", "la", "el", "los", "las", "en", "y", "o", "a", "the", "of"]);

function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2 && !STOPWORDS.has(t))
  );
}

export interface ExistingField {
  apiName: string;
  label: string;
}

export function findSimilarFields(
  newApiName: string,
  newLabel: string,
  existing: ExistingField[]
): ExistingField[] {
  const newTokens = new Set([...tokens(newApiName), ...tokens(newLabel)]);
  const hits: Array<{ field: ExistingField; overlap: number }> = [];

  for (const field of existing) {
    const fieldTokens = new Set([...tokens(field.apiName), ...tokens(field.label)]);
    let overlap = 0;
    for (const t of newTokens) {
      // el prefijo del objeto (contact/deal) no cuenta como solapamiento
      if (fieldTokens.has(t) && !["contact", "deal", "quote", "activity"].includes(t)) overlap++;
    }
    if (overlap > 0) hits.push({ field, overlap });
  }
  return hits.sort((a, b) => b.overlap - a.overlap).map((h) => h.field);
}
