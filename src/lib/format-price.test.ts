import { describe, it, expect } from "vitest";
import { formatPriceRange } from "./format-price";

describe("formatPriceRange", () => {
  it("retorna null cuando ambos precios son null (el caller decide el fallback)", () => {
    expect(formatPriceRange(null, null)).toBeNull();
  });

  it("regresión: priceMinMxn null pero priceMaxMxn presente cae al máximo, no a null", () => {
    // Este era el bug: la lista mostraba "Precio no publicado" en este caso exacto,
    // mientras la ficha (ya corregida en 0125258) sí mostraba el máximo.
    expect(formatPriceRange(null, 3_200_000)).toBe(formatPriceRange(3_200_000, 3_200_000));
    expect(formatPriceRange(null, 3_200_000)).toMatch(/3,200,000/);
  });

  it("con solo priceMinMxn muestra un único valor sin rango", () => {
    expect(formatPriceRange(1_500_000, null)).toMatch(/1,500,000/);
    expect(formatPriceRange(1_500_000, null)).not.toContain("–");
  });

  it("con ambos iguales muestra un único valor, no un rango redundante", () => {
    const r = formatPriceRange(2_000_000, 2_000_000);
    expect(r).not.toContain("–");
    expect(r).toMatch(/2,000,000/);
  });

  it("con ambos distintos muestra el rango min – max", () => {
    const r = formatPriceRange(1_500_000, 3_200_000)!;
    expect(r).toContain("–");
    expect(r).toMatch(/1,500,000/);
    expect(r).toMatch(/3,200,000/);
    expect(r.indexOf("1,500,000")).toBeLessThan(r.indexOf("3,200,000"));
  });
});
