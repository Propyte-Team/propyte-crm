export interface PriceableSnapshot {
  moneda?: string | null;
  precioMxn?: number | null;
  precioUsd?: number | null;
  // forma optimista del panel (desde /api/hub/units, antes del refresh): precio único mapeado
  price?: number | null;
}

/** Elige precio de lista + moneda del snapshot de la unidad para crear una Quote. */
export function pickSnapshotPrice(s: PriceableSnapshot): {
  listPrice: number | null;
  currency: "MXN" | "USD";
} {
  const currency: "MXN" | "USD" = s?.moneda === "USD" ? "USD" : "MXN";
  const persisted = currency === "USD" ? s?.precioUsd : s?.precioMxn;
  // fallback a `price` (item optimista recién agregado, aún sin snapshot persistido)
  const listPrice = persisted ?? s?.price ?? null;
  return { listPrice, currency };
}
