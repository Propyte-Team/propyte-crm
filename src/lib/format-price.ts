// Formateo de rango de precio para desarrollos (lista y ficha de /developments).
//
// Antes de esta función, developments-client.tsx y development-detail-client.tsx
// duplicaban esta lógica y divergían: la ficha caía a priceMaxMxn cuando priceMinMxn
// era null, la lista no y mostraba "Precio no publicado" aunque sí hubiera precio.
// Formateadores duplicados que divergen son justo el origen de ese bug — de ahí
// centralizarlo aquí en vez de repetirlo una tercera vez.
import { formatCurrency } from "./constants";

/**
 * Devuelve el precio (o rango min–max) ya formateado en MXN, o `null` si AMBOS
 * priceMinMxn/priceMaxMxn son null. El caller decide el texto de fallback
 * ("Precio no publicado", "—", etc.) — esta función no lo impone.
 */
export function formatPriceRange(
  priceMinMxn: number | null,
  priceMaxMxn: number | null
): string | null {
  if (priceMinMxn == null && priceMaxMxn == null) return null;

  // Si falta el mínimo, el máximo es el único valor disponible — se muestra solo,
  // sin sufijo de rango (no hay con qué formar el rango).
  const base = priceMinMxn ?? priceMaxMxn!;
  const other = priceMinMxn != null ? priceMaxMxn : null;

  if (other != null && other !== base) {
    return `${formatCurrency(base, "MXN")} – ${formatCurrency(other, "MXN")}`;
  }
  return formatCurrency(base, "MXN");
}
