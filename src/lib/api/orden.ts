// ============================================================
// Listas blancas de ordenamiento para los listados de la API
// ============================================================
//
// Tarjeta #745 · AUD-20260903 D-11 (ampliado en el repaso de medios del 2026-09-08).
//
// Cinco listados armaban `orderBy: { [sortBy]: sortOrder }` con el valor crudo del query
// string. Una columna inventada —o un sentido mal escrito, `?sortOrder=ascending` en vez
// de `asc`— hacía que Prisma lanzara PrismaClientValidationError y la ruta devolviera 500.
// Un parámetro mal escrito es culpa de quien llama: eso es un 400, no un error interno.
//
// La lista blanca además cierra la puerta a ordenar por columnas que el listado no expone
// (`custom`, `zohoId`, los `commission*` del deal), que es la otra mitad del problema:
// `orderBy` con nombre libre es una superficie de consulta que nadie diseñó.

/** Los dos únicos sentidos que Prisma acepta. */
export const SENTIDOS_DE_ORDEN = ["asc", "desc"] as const;
export type SentidoDeOrden = (typeof SENTIDOS_DE_ORDEN)[number];

interface Ordenable {
  /** Columnas por las que este listado se puede ordenar. */
  readonly columnas: readonly string[];
  /** Columna que se usa si no viene `sortBy`. Debe estar en `columnas`. */
  readonly porDefecto: string;
  /** Sentido que se usa si no viene `sortOrder`. */
  readonly sentidoPorDefecto: SentidoDeOrden;
}

/**
 * Una entrada por listado. Los valores por defecto son los que cada ruta ya tenía, para
 * que esta validación no cambie el orden de ninguna pantalla: solo rechaza lo inválido.
 */
export const ORDEN_POR_ENTIDAD = {
  contact: {
    columnas: [
      "createdAt", "updatedAt", "firstName", "lastName", "email", "phone",
      "score", "temperature", "contactStatus", "contactType", "leadSource",
      "lifecycleStage", "lastActivityAt", "budgetMin", "budgetMax",
    ],
    porDefecto: "createdAt",
    sentidoPorDefecto: "desc",
  },
  deal: {
    columnas: [
      "createdAt", "updatedAt", "stage", "dealType", "estimatedValue",
      "probability", "expectedCloseDate", "actualCloseDate", "reservedAt",
      "commissionStatus", "currency",
    ],
    porDefecto: "createdAt",
    sentidoPorDefecto: "desc",
  },
  activity: {
    columnas: [
      "createdAt", "updatedAt", "dueDate", "completedAt", "subject",
      "activityType", "status", "duration_minutes",
    ],
    porDefecto: "createdAt",
    sentidoPorDefecto: "desc",
  },
  unit: {
    columnas: [
      "unitNumber", "price", "area_m2", "floor", "status", "unitType",
      "createdAt", "updatedAt", "reservationDate", "saleDate",
    ],
    porDefecto: "unitNumber",
    sentidoPorDefecto: "asc",
  },
} as const satisfies Record<string, Ordenable>;

export type EntidadOrdenable = keyof typeof ORDEN_POR_ENTIDAD;

/**
 * Las columnas válidas de una entidad, como tipo. Sirve para que quien llama desde dentro
 * del código (no por query string) se equivoque en tiempo de compilación y no en runtime.
 */
export type ColumnaOrdenable<E extends EntidadOrdenable> =
  (typeof ORDEN_POR_ENTIDAD)[E]["columnas"][number];

/** El `orderBy` listo para Prisma, o el mensaje de error para devolver con 400. */
export type ResultadoDeOrden =
  | { orderBy: Record<string, SentidoDeOrden>; error?: undefined }
  | { orderBy?: undefined; error: string };

/**
 * Valida `sortBy` y `sortOrder` contra la lista blanca de la entidad y devuelve el
 * `orderBy` de Prisma. Ausente o vacío ⇒ los valores por defecto de la entidad.
 *
 * Nunca lanza: quien llama decide si contesta 400 o usa el orden por defecto.
 */
export function ordenValidado(
  entidad: EntidadOrdenable,
  sortBy?: string | null,
  sortOrder?: string | null
): ResultadoDeOrden {
  const { columnas, porDefecto, sentidoPorDefecto } = ORDEN_POR_ENTIDAD[entidad];

  const columna = sortBy?.trim() || porDefecto;
  // El cast es necesario: con `entidad` genérica, `columnas` es la unión de las cuatro
  // tuplas y TypeScript exige que el argumento sea de la INTERSECCIÓN de sus elementos.
  if (!(columnas as readonly string[]).includes(columna)) {
    return {
      error: `sortBy inválido: "${columna}". Válidos: ${columnas.join(", ")}`,
    };
  }

  const sentido = sortOrder?.trim() || sentidoPorDefecto;
  if (!(SENTIDOS_DE_ORDEN as readonly string[]).includes(sentido)) {
    return { error: `sortOrder inválido: "${sentido}". Válidos: asc, desc` };
  }

  return { orderBy: { [columna]: sentido as SentidoDeOrden } };
}
