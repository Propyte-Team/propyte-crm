// Normalizacion y validacion de las negativas de una regla, compartida por el
// POST y el PATCH: las dos rutas tienen que rechazar exactamente lo mismo o la
// regla se puede dejar muerta editandola.
import { normalize } from "./match";

/** Normaliza, quita vacios y duplicados. Mismo trato que las frases. */
export function normalizeExclusions(input: string[] | undefined | null): string[] {
  return [...new Set((input ?? []).map(normalize).filter(Boolean))];
}

/**
 * Una negativa IDENTICA a una frase de la misma regla la deja muerta: la frase
 * hace match y acto seguido la negativa lo veta, siempre, sin sintoma visible.
 * Se rechaza al guardar porque en produccion se veria como "la regla no
 * dispara" y nadie sospecharia de la lista de negativas.
 *
 * Una negativa que solo CONTIENE la frase ("ya no hay info" frente a "info") es
 * justo el caso de uso y se permite.
 */
export function findSelfVeto(phrases: string[], exclusions: string[]): string | null {
  return exclusions.find((e) => phrases.includes(e)) ?? null;
}
