// Badge de marca y opciones del filtro «Marca» — módulo PURO (2026-10-12, entrega 3 de 3).
// Sin Prisma ni React: lo usan las páginas (servidor) para armar el contexto y los componentes
// (cliente) para pintar el badge, con la misma regla en los dos lados.
//
// Decisión 2 del dueño: cada contacto muestra su(s) marca(s) en Contactos, Bandeja, Negocios y
// la ficha, de forma discreta. Para que no se vuelva ruido:
//   · quien ve UNA sola marca (la predeterminada, el caso de casi todo el equipo hoy) no ve badge
//     en lo que es solo de la predeterminada — sería "Propyte" en cada renglón;
//   · quien ve VARIAS sí ve también la predeterminada, porque ahí el badge es lo que distingue;
//   · una marca NO predeterminada se pinta siempre: si alguien que solo ve Propyte la tiene en su
//     lista, es porque se la asignaron, y saber que es de Yaxnáh le cambia cómo contestar.
import type { VisibleBrands } from "./visibility";

/** Lo mínimo de una marca que viaja al cliente. */
export type BrandLite = { id: string; name: string; isDefault: boolean };

export type BrandViewContext = {
  /** Marcas vivas (predeterminada primero): sirven para NOMBRAR el badge de cualquier registro visible. */
  brands: BrandLite[];
  /** Marcas que el usuario puede elegir en el filtro: las que ve. */
  options: BrandLite[];
  /** Ve más de una marca: el badge de la predeterminada sí aporta. También decide si hay selector. */
  multiBrand: boolean;
};

/** Contexto vacío: si no se pudieron leer las marcas, no hay badges ni selector (y nada se rompe). */
export const EMPTY_BRAND_VIEW: BrandViewContext = { brands: [], options: [], multiBrand: false };

/**
 * Arma el contexto con la misma regla de visibility.ts.
 * @param liveBrands marcas no borradas, en el orden en que se quieren mostrar.
 */
export function buildBrandViewContext(
  liveBrands: readonly BrandLite[],
  visible: VisibleBrands,
): BrandViewContext {
  const options =
    visible === "ALL"
      ? [...liveBrands]
      : liveBrands.filter((b) => visible.brandIds.includes(b.id) || (b.isDefault && visible.includesDefault));
  return { brands: [...liveBrands], options, multiBrand: options.length > 1 };
}

/**
 * Marcas que se pintan para un registro.
 * @param recordBrandIds filas de contact_brands del contacto (o la marca de la cuenta de un hilo).
 *   `[]` = sin filas = de la predeterminada (spec 2026-10-09 §2.3). `null`/`undefined` = el
 *   registro se leyó sin marcas: no se adivina y no se pinta nada.
 * @param opts.alreadyShown nombre que la pantalla ya muestra junto al registro (la etiqueta de la
 *   cuenta en la bandeja, «WhatsApp · Yaxnáh Caucel»): no se repite.
 */
export function brandBadges(
  recordBrandIds: readonly string[] | null | undefined,
  ctx: Pick<BrandViewContext, "brands" | "multiBrand">,
  opts: { alreadyShown?: string | null } = {},
): BrandLite[] {
  if (!recordBrandIds) return [];
  // Se recorre el contexto y no las filas: así sale en el orden de la base, sin duplicados y sin
  // las marcas borradas (que ya no están entre las vivas).
  const resolved =
    recordBrandIds.length === 0
      ? ctx.brands.filter((b) => b.isDefault)
      : ctx.brands.filter((b) => recordBrandIds.includes(b.id));
  if (resolved.length === 0) return [];
  if (!ctx.multiBrand && resolved.every((b) => b.isDefault)) return [];
  return opts.alreadyShown ? resolved.filter((b) => b.name !== opts.alreadyShown) : resolved;
}
