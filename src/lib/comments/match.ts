// Matcher de reglas de comentarios. Función pura: sin Prisma, sin fetch, sin
// Date.now(). Todo lo que decide "esta regla gana" vive aquí y se prueba solo.

export interface CommentRuleLike {
  id: string;
  priority: number;
  phrases: string[];
  postFilter: string[];
  createdAt: Date;
}

export interface MatchResult<T extends CommentRuleLike = CommentRuleLike> {
  rule: T;
  phrase: string;
}

/** Minusculas, sin diacriticos, espacios colapsados. */
export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Palabra completa: el caracter pegado a cada extremo no puede ser letra ni
 * digito ni guion bajo (`_` cuenta como caracter de palabra, igual que en
 * `\w`). Asi "info" dispara con "¿info?" y "info 🙏" pero NO con "informal",
 * "informacion", "@promo_info" (mencion de otra cuenta) ni "#info_venta"
 * (hashtag compuesto) -- el falso positivo que publicaria una respuesta a
 * quien no pidio informacion. Espera `text` ya normalizado; normaliza
 * `phrase` por su cuenta.
 */
export function containsPhrase(text: string, phrase: string): boolean {
  const needle = normalize(phrase);
  if (!needle) return false;
  const re = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(needle)}(?![\\p{L}\\p{N}_])`, "u");
  return re.test(text);
}

/**
 * Primera regla que coincide gana: orden por priority asc y luego antiguedad.
 * Las demas no se evaluan (una respuesta por comentario, nunca dos).
 */
export function matchRule<T extends CommentRuleLike>(
  rules: T[],
  commentText: string,
  postId: string
): MatchResult<T> | null {
  const text = normalize(commentText);
  if (!text) return null;

  const ordered = [...rules].sort(
    (a, b) =>
      a.priority - b.priority ||
      a.createdAt.getTime() - b.createdAt.getTime() ||
      a.id.localeCompare(b.id)
  );

  for (const rule of ordered) {
    if (rule.postFilter.length > 0 && !rule.postFilter.includes(postId)) continue;
    for (const phrase of rule.phrases) {
      if (containsPhrase(text, phrase)) return { rule, phrase };
    }
  }
  return null;
}
