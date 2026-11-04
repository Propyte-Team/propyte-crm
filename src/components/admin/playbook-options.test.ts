import { describe, it, expect } from "vitest";
import {
  agregarSinonimos, errorDeOpciones, etiquetaDeValor, leerOpciones, opcionesDeFabrica, opcionesParaGuardar,
  quitarSinonimo, tieneValoresFijos,
} from "./playbook-options";
import { NATIVE_TARGET_FIELDS } from "@/lib/bot/playbook/fields";

describe("playbook-options", () => {
  it("lee lo guardado y descarta basura", () => {
    expect(leerOpciones([{ value: "CASA", synonyms: ["casita", 3] }, { value: "" }, null, "x"])).toEqual([
      { value: "CASA", synonyms: ["casita", "3"] },
    ]);
    expect(leerOpciones(undefined)).toEqual([]);
  });

  it("conserva la forma guardada (round-trip)", () => {
    const guardado = [{ value: "DEPARTAMENTO", synonyms: ["depa", "depto"] }, { value: "CASA", synonyms: [] }];
    expect(opcionesParaGuardar(leerOpciones(guardado))).toEqual(guardado);
  });

  it("agrega sinónimos separados por coma, sin repetir ni igualar al valor", () => {
    expect(agregarSinonimos(["depa"], " Depto , DEPA, casa ,, ", "CASA")).toEqual(["depa", "Depto"]);
    expect(quitarSinonimo(["a", "b"], "a")).toEqual(["b"]);
  });

  it("al guardar quita filas vacías y valores repetidos", () => {
    expect(
      opcionesParaGuardar([
        { value: " A ", synonyms: ["x", "X"] },
        { value: "", synonyms: ["y"] },
        { value: "A", synonyms: [] },
      ]),
    ).toEqual([{ value: "A", synonyms: ["x"] }]);
  });

  it("errorDeOpciones", () => {
    expect(errorDeOpciones([])).toMatch(/al menos una/);
    expect(errorDeOpciones([{ value: "A", synonyms: [] }, { value: "A", synonyms: [] }])).toMatch(/repetidas/);
    expect(errorDeOpciones([{ value: "A", synonyms: [] }])).toBeNull();
  });

  it("todo valor de fábrica de un campo nativo tiene etiqueta en español (no queda en inglés)", () => {
    for (const [campo, spec] of Object.entries(NATIVE_TARGET_FIELDS)) {
      for (const v of spec.enumValues ?? []) {
        const e = etiquetaDeValor(campo, v);
        expect(e, `${campo}.${v}`).not.toBe(v === v.toUpperCase() ? v : "");
        expect(e).not.toMatch(/^[A-Z_]+$/);
      }
    }
    expect(etiquetaDeValor("purchaseTimeline", "IMMEDIATE")).toBe("Inmediata");
    expect(etiquetaDeValor("custom.mascota", "Perro")).toBe("Perro");
  });

  it("opciones de fábrica y valores fijos", () => {
    expect(opcionesDeFabrica("paymentMethod")).toHaveLength(4);
    expect(opcionesDeFabrica("custom.x")).toEqual([]);
    expect(tieneValoresFijos("paymentMethod")).toBe(true);
    expect(tieneValoresFijos("firstName")).toBe(false);
  });
});
