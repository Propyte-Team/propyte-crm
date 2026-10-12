// «Marcas que ve» en el formulario de usuario — módulo PURO (2026-10-12, spec marcas-visibilidad).
// Misma regla que src/lib/brands/visibility.ts, vista desde la pantalla: sin filas = solo la
// predeterminada marcada; con filas = las suyas que sigan vivas.

export interface BrandOption {
  id: string;
  name: string;
  isDefault: boolean;
}

/**
 * Conjunto que hay que mostrar marcado. `explicit === null` = el usuario no tiene filas.
 * Las marcas borradas no salen en `brands`, así que tampoco se marcan.
 */
export function effectiveBrandIds(brands: readonly BrandOption[], explicit: readonly string[] | null): string[] {
  if (explicit === null) return brands.filter((b) => b.isDefault).map((b) => b.id);
  const vivas = new Set(brands.map((b) => b.id));
  return explicit.filter((id) => vivas.has(id));
}

/** ¿Mismo conjunto, sin importar el orden? Solo se guarda si el admin cambió algo. */
export function sameBrandSet(a: readonly string[], b: readonly string[]): boolean {
  const sa = new Set(a);
  const sb = new Set(b);
  return sa.size === sb.size && Array.from(sa).every((id) => sb.has(id));
}

/** Prende o apaga una marca, conservando el orden de la lista de marcas. */
export function toggleBrand(brands: readonly BrandOption[], selected: readonly string[], id: string): string[] {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return brands.map((b) => b.id).filter((bid) => next.has(bid));
}
