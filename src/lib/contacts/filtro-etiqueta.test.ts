import { describe, it, expect } from "vitest";
import { etiquetaDelFiltro, whereEtiqueta } from "./filtro-etiqueta";

describe("filtro ?etiqueta= de Contactos (#958)", () => {
  it("toma el valor tal cual, sin espacios de sobra", () => {
    expect(etiquetaDelFiltro("falta-razon")).toBe("falta-razon");
    expect(etiquetaDelFiltro("  LEAD   FRIO ")).toBe("LEAD FRIO");
    expect(etiquetaDelFiltro(["confirmar-broker", "otra"])).toBe("confirmar-broker");
  });
  it("vacío o más largo que una etiqueta = sin filtro", () => {
    expect(etiquetaDelFiltro(null)).toBeNull();
    expect(etiquetaDelFiltro("   ")).toBeNull();
    expect(etiquetaDelFiltro("x".repeat(51))).toBeNull();
  });
  it("condición de Prisma", () => {
    expect(whereEtiqueta("falta-razon")).toEqual({ tags: { has: "falta-razon" } });
    expect(whereEtiqueta(null)).toBeNull();
  });
});
