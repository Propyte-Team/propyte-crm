// Matcher de reglas de comentarios. Función pura: sin Prisma, sin fetch, sin
// Date.now(). Todo lo que decide "esta regla gana" vive aquí y se prueba solo.

export interface CommentRuleLike {
  id: string;
  priority: number;
  phrases: string[];
  /**
   * Negativas: si alguna aparece en el comentario, la regla NO dispara aunque
   * una de sus `phrases` sí esté. Existe porque las frases útiles son palabras
   * sueltas ("info", "venta", "estudio") y sin negativas contestan a quien no
   * preguntó: "estudio de arquitectura", "¿ya no está en venta?", "soy broker".
   * Se evalúan DESPUÉS de las frases —primero hay que tener algo que vetar— y
   * con el mismo criterio de palabra completa.
   */
  excludePhrases: string[];
  postFilter: string[];
  createdAt: Date;
}

export interface MatchResult<T extends CommentRuleLike = CommentRuleLike> {
  rule: T;
  phrase: string;
}

/** Regla que habría ganado pero la vetó una negativa. */
export interface ExclusionResult<T extends CommentRuleLike = CommentRuleLike> {
  rule: T;
  /** La frase que sí coincidió: sin ella no habría nada que vetar. */
  phrase: string;
  /** La negativa que la vetó. */
  excludedBy: string;
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

/** Primera frase de la lista presente en `text` (ya normalizado), o null. */
function firstHit(text: string, phrases: string[] | null | undefined): string | null {
  for (const phrase of phrases ?? []) {
    if (containsPhrase(text, phrase)) return phrase;
  }
  return null;
}

/**
 * Orden de evaluacion: priority asc, luego antiguedad y por ultimo `id`. El
 * tercer criterio no es adorno: con priority y createdAt iguales el orden
 * dependia de como viniera el arreglo de Prisma (findMany sin orderBy), asi que
 * la misma palabra podia responder con reglas distintas. Copia el arreglo: no
 * se muta lo que nos pasan.
 */
function orderRules<T extends CommentRuleLike>(rules: T[]): T[] {
  return [...rules].sort(
    (a, b) =>
      a.priority - b.priority ||
      a.createdAt.getTime() - b.createdAt.getTime() ||
      a.id.localeCompare(b.id)
  );
}

/** true si la regla no aplica a esa publicacion. postFilter vacio = toda la cuenta. */
function outOfScope(rule: CommentRuleLike, postId: string): boolean {
  return rule.postFilter.length > 0 && !rule.postFilter.includes(postId);
}

/**
 * Primera regla que coincide gana. Las demas no se evaluan (una respuesta por
 * comentario, nunca dos).
 *
 * Una regla vetada por sus propias negativas se salta y **se sigue con la
 * siguiente**: la exclusion es propiedad de esa regla, no del comentario. Asi
 * una regla estrecha con negativas puede convivir con otra mas general sin
 * apagarla, y quitar una negativa nunca cambia el comportamiento de otra regla.
 *
 * Generico en `T` para que quien pase el objeto completo de Prisma recupere sus
 * campos desde `match.rule` sin castear ni volver a buscarlo en el arreglo.
 */
export function matchRule<T extends CommentRuleLike>(
  rules: T[],
  commentText: string,
  postId: string
): MatchResult<T> | null {
  const text = normalize(commentText);
  if (!text) return null;

  for (const rule of orderRules(rules)) {
    if (outOfScope(rule, postId)) continue;
    const phrase = firstHit(text, rule.phrases);
    if (!phrase) continue;
    if (firstHit(text, rule.excludePhrases)) continue;
    return { rule, phrase };
  }
  return null;
}

/**
 * Igual que `matchRule` pero devuelve la primera regla que SI coincidio y fue
 * vetada por una negativa. Es lo que contesta "¿por que no disparo?" en el
 * probador: sin esto, una negativa mal puesta se ve identica a no tener ninguna
 * regla, y el silencio no se puede depurar sin leer la base.
 */
export function findExclusion<T extends CommentRuleLike>(
  rules: T[],
  commentText: string,
  postId: string
): ExclusionResult<T> | null {
  const text = normalize(commentText);
  if (!text) return null;

  for (const rule of orderRules(rules)) {
    if (outOfScope(rule, postId)) continue;
    const phrase = firstHit(text, rule.phrases);
    if (!phrase) continue;
    const excludedBy = firstHit(text, rule.excludePhrases);
    if (excludedBy) return { rule, phrase, excludedBy };
  }
  return null;
}
