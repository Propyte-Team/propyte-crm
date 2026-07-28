import { describe, it, expect } from "vitest";
import { formatFinancingMonths } from "./format-financing";

describe("formatFinancingMonths (financingMonths es un array, no un escalar)", () => {
  it("retorna null cuando no hay datos (null)", () => {
    expect(formatFinancingMonths(null)).toBeNull();
  });

  it("retorna null cuando el array está vacío", () => {
    expect(formatFinancingMonths([])).toBeNull();
  });

  it("formatea un único plazo", () => {
    expect(formatFinancingMonths([12])).toBe("12 meses");
  });

  it("formatea múltiples plazos separados por '/', sin concatenarlos como número", () => {
    expect(formatFinancingMonths([12, 24, 36, 48, 60])).toBe("12/24/36/48/60 meses");
  });
});
