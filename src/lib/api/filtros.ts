// ============================================================
// Validación de filtros que llegan por query string
// ============================================================
//
// Tarjeta #745, la segunda mitad (hallazgo N-3 del repaso de medios del 2026-09-08).
//
// El listado de unidades pasaba los filtros crudos a Prisma:
//
//   where.status   = status as any          → un estado inexistente ⇒ 500
//   where.unitType = unitType as any        → lo mismo
//   where.price    = { gte: parseFloat(x) } → `?minPrice=abc` ⇒ `gte: NaN` en el filtro
//
// Los dos primeros son PrismaClientValidationError. El de `NaN` es peor porque no falla:
// Prisma serializa el NaN y el filtro se comporta de forma indefinida, así que el listado
// devuelve algo —normalmente vacío— sin avisar de que el parámetro no era un número.
//
// Los valores de los enums van escritos a mano, como en los `z.enum([...])` del resto del
// repositorio, y no leídos del cliente de Prisma: así una prueba unitaria no necesita el
// cliente generado para correr. El costo es tenerlos sincronizados con el schema.

/** UnitStatus en prisma/schema.prisma. */
export const ESTADOS_DE_UNIDAD = [
  "DISPONIBLE",
  "APARTADA",
  "VENDIDA",
  "NO_DISPONIBLE",
] as const;

/** UnitType en prisma/schema.prisma. */
export const TIPOS_DE_UNIDAD = [
  "DEPTO_1REC",
  "DEPTO_2REC",
  "DEPTO_3REC",
  "PENTHOUSE",
  "CASA",
  "TERRENO",
  "MACROLOTE",
  "LOCAL",
] as const;

/** El valor validado, o el mensaje de error para devolver con 400. */
export type ResultadoDeValor<T> =
  | { valor: T; error?: undefined }
  | { valor?: undefined; error: string };

/**
 * Comprueba que el valor esté en la lista de un enum. Ausente o vacío ⇒ `undefined`,
 * que en Prisma significa "no filtrar por este campo".
 */
export function valorDeEnum<T extends string>(
  nombre: string,
  permitidos: readonly T[],
  valor?: string | null
): ResultadoDeValor<T | undefined> {
  const v = valor?.trim();
  if (!v) return { valor: undefined };

  if (!(permitidos as readonly string[]).includes(v)) {
    return { error: `${nombre} inválido: "${v}". Válidos: ${permitidos.join(", ")}` };
  }
  return { valor: v as T };
}

/**
 * Convierte a número y exige que sea finito y no negativo. Ausente o vacío ⇒ `undefined`.
 *
 * Se usa `Number` y no `parseFloat` a propósito: `parseFloat("12abc")` devuelve 12 y se
 * traga la basura, mientras que `Number("12abc")` es NaN y aquí se rechaza.
 */
export function numeroNoNegativo(
  nombre: string,
  valor?: string | null
): ResultadoDeValor<number | undefined> {
  const v = valor?.trim();
  if (!v) return { valor: undefined };

  const n = Number(v);
  if (!Number.isFinite(n)) {
    return { error: `${nombre} debe ser un número: se recibió "${v}"` };
  }
  if (n < 0) {
    return { error: `${nombre} no puede ser negativo: se recibió "${v}"` };
  }
  return { valor: n };
}
