export interface PriceableSnapshot {
  moneda?: string | null;
  precioMxn?: number | null;
  precioUsd?: number | null;
}

/** Elige precio de lista + moneda del snapshot de la unidad para crear una Quote. */
export function pickSnapshotPrice(s: PriceableSnapshot): {
  listPrice: number | null;
  currency: "MXN" | "USD";
} {
  const currency: "MXN" | "USD" = s?.moneda === "USD" ? "USD" : "MXN";
  const listPrice = (currency === "USD" ? s?.precioUsd : s?.precioMxn) ?? null;
  return { listPrice, currency };
}
