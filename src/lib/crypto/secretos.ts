// ============================================================
// Comparación de secretos en tiempo constante
// ============================================================
//
// Tarjeta #736 · AUD-20260903 S-09 (ampliado de 3 a 10 sitios en el repaso del 2026-09-08).
//
// ## Por qué no se comparan secretos con `===`
//
// `===` sobre cadenas se detiene en el primer carácter distinto. El tiempo que tarda en
// devolver `false` depende, entonces, de cuántos caracteres iniciales acertó quien llama —
// y de si la longitud coincide. Con suficientes intentos y midiendo el tiempo de respuesta,
// eso permite adivinar el secreto carácter por carácter en lugar de tener que acertarlo
// completo: el espacio de búsqueda pasa de exponencial a lineal.
//
// La objeción razonable es que sobre HTTP el ruido de red tapa esas diferencias de
// nanosegundos. Es cierto que lo dificulta, no que lo impida: promediando miles de
// mediciones la señal se recupera, y hay ataques publicados que lo hacen sobre red. De
// todos modos el argumento es ocioso, porque la forma correcta cuesta lo mismo.
//
// ## Por qué este archivo existe
//
// La forma correcta ya estaba escrita TRES veces en el repositorio —`igualSeguro` en
// lib/cron/auth.ts, `checkBearer` en lib/mcp/auth.ts y `tokensCoinciden` en
// lib/mcp/revision/auth.ts—, cada una en su rincón, mientras diez puntos de entrada
// seguían con `===`. Tres copias de lo correcto y diez sitios sin ello es exactamente lo
// que pasa cuando algo no tiene un lugar donde vivir. Ahora lo tiene.

import { timingSafeEqual } from "crypto";

/**
 * ¿Son iguales estos dos secretos? Comparación en tiempo constante.
 *
 * Acepta `null`/`undefined` en ambos lados a propósito: casi todos los llamadores leen el
 * secreto de una cabecera (que puede faltar) y lo comparan contra una variable de entorno
 * (que puede no estar configurada). Cualquiera de las dos ausente ⇒ `false`. Así el
 * llamador no necesita su propio `if` previo, que es donde se colaba el `===`.
 *
 * `timingSafeEqual` lanza si los buffers miden distinto, así que la longitud se resuelve
 * antes con un `return false`. Eso **filtra la longitud del secreto**, y no hay forma de
 * evitarlo sin hashear ambos lados primero; se acepta porque conocer la longitud no reduce
 * el espacio de búsqueda de forma útil, y porque es lo que ya hacían los tres helpers.
 */
export function secretosIguales(
  recibido: string | null | undefined,
  esperado: string | null | undefined
): boolean {
  if (!recibido || !esperado) return false;

  const a = Buffer.from(recibido, "utf8");
  const b = Buffer.from(esperado, "utf8");
  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}

/**
 * Igual que `secretosIguales`, pero recorta espacios y saltos de línea de los dos lados.
 *
 * Existe porque casi todos los llamadores ya hacían `?.trim()` sobre la cabecera y sobre
 * `process.env`: un `\n` al final de una variable de entorno mal pegada es el error de
 * configuración más común de este repositorio, y ya está anotado como "gotcha conocido" en
 * lib/mcp/auth.ts. Se deja explícito en el nombre para que se vea cuándo se está recortando.
 */
export function secretosIgualesRecortados(
  recibido: string | null | undefined,
  esperado: string | null | undefined
): boolean {
  return secretosIguales(recibido?.trim(), esperado?.trim());
}

/**
 * Busca el primer elemento cuyo secreto coincide, comparando todos en tiempo constante.
 *
 * Los webhooks de conectores (Meta, Google Ads, portales, sitio web) no tienen UN secreto:
 * tienen una fila por conector activo y hay que encontrar cuál corresponde. Con
 * `.find(c => c.secreto === recibido)` había dos fugas: la del `===` y la del corte
 * temprano, que revela **cuántos conectores se revisaron antes de acertar**.
 *
 * Aquí se recorren todos siempre —sin `break`— y se devuelve el último que coincidió. Como
 * mucho puede coincidir uno, así que "el último" es "el único".
 */
export function buscarPorSecreto<T>(
  elementos: readonly T[],
  recibido: string | null | undefined,
  secretoDe: (elemento: T) => string | null | undefined
): T | null {
  let encontrado: T | null = null;

  for (const elemento of elementos) {
    if (secretosIguales(recibido, secretoDe(elemento))) encontrado = elemento;
  }

  return encontrado;
}
