/**
 * Redacción de datos personales antes de que salgan por la puerta.
 *
 * POR QUÉ NO ES OPCIONAL. Lo que consume esta puerta es Cowork, en claude.ai, corriendo
 * a diario y sin supervisión. Las tools devuelven conteos, pero los MENSAJES DE ERROR no
 * son conteos: un `errorDetail` de un conector trae el payload que reventó, y ese payload
 * es un lead con su nombre, su correo y su teléfono.
 *
 * La regla del spec (§9.1) es "cero PII". Esto es lo que la hace cierta en el único lugar
 * donde el texto libre se escapa: los ejemplos de `crm_fallos`.
 */

/** Correos. */
const CORREO = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

/**
 * Teléfonos. Un teléfono vive en cinco formatos en esta casa (`+521…`, `52…`, con
 * espacios, con guiones, con paréntesis) y un patrón que solo cubre uno deja pasar los
 * otros cuatro. Se buscan corridas de 8 a 15 dígitos admitiendo separadores.
 */
const TELEFONO = /(?:\+?\d[\s().-]?){8,15}/g;

/** UUIDs: no son PII, pero identifican una fila y ensucian el agrupado. */
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

export function redactar(texto: string | null | undefined): string {
  if (!texto) return "";
  return texto
    .replace(CORREO, "«correo»")
    .replace(UUID, "«id»")
    .replace(TELEFONO, (m) => (m.replace(/\D/g, "").length >= 8 ? "«teléfono»" : m));
}

/**
 * Firma de un mensaje de error, para agrupar.
 *
 * Sin esto, "contacto 3f2a… no encontrado" y "contacto 9b1c… no encontrado" cuentan como
 * dos fallos distintos, y 400 instancias del MISMO bug se leen como 400 bugs. Agrupar es
 * lo que convierte un log en una medición.
 */
export function firmaDeError(texto: string | null | undefined): string {
  return redactar(texto)
    .replace(/\d+/g, "N")
    .replace(/["'`].*?["'`]/g, "«valor»")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}
