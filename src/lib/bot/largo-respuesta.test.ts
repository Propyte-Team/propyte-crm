import { describe, expect, it } from "vitest";
import { largoDeLineas, lineasDeLargo, maxTokensDeLineas } from "./largo-respuesta";

describe("largo de respuesta", () => {
  it("mapea las líneas guardadas a la opción más cercana", () => {
    expect([1, 2].map(largoDeLineas)).toEqual(["corto", "corto"]);
    expect([3, 4].map(largoDeLineas)).toEqual(["normal", "normal"]);
    expect([5, 6, 8].map(largoDeLineas)).toEqual(["largo", "largo", "largo"]);
    expect(largoDeLineas(NaN)).toBe("corto");
  });
  it("ida y vuelta de las tres opciones", () => {
    for (const l of ["corto", "normal", "largo"] as const) expect(largoDeLineas(lineasDeLargo(l))).toBe(l);
  });
  it("el valor por defecto (4 líneas) conserva los 300 tokens de siempre", () => {
    expect(maxTokensDeLineas(4)).toBe(300);
    expect(maxTokensDeLineas(undefined)).toBe(300);
    expect(maxTokensDeLineas(2)).toBe(200);
    expect(maxTokensDeLineas(6)).toBe(450);
  });
});
