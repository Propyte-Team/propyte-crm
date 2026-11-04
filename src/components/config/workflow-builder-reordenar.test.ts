import { describe, expect, it } from "vitest";
import { indiceAbiertoTrasReordenar, reordenarAcciones } from "./workflow-builder-model";

describe("reordenarAcciones", () => {
  it("mueve hacia abajo y hacia arriba", () => {
    expect(reordenarAcciones(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(reordenarAcciones(["a", "b", "c", "d"], 3, 1)).toEqual(["a", "d", "b", "c"]);
  });
  it("no cambia con índices iguales o fuera de rango", () => {
    const l = ["a", "b"];
    expect(reordenarAcciones(l, 1, 1)).toBe(l);
    expect(reordenarAcciones(l, -1, 0)).toBe(l);
    expect(reordenarAcciones(l, 0, 5)).toBe(l);
  });
  it("no muta la lista original", () => {
    const l = ["a", "b", "c"];
    reordenarAcciones(l, 0, 2);
    expect(l).toEqual(["a", "b", "c"]);
  });
});

describe("indiceAbiertoTrasReordenar", () => {
  it("sigue a la tarjeta movida", () => expect(indiceAbiertoTrasReordenar(0, 0, 2)).toBe(2));
  it("recorre las intermedias", () => {
    expect(indiceAbiertoTrasReordenar(1, 0, 2)).toBe(0);
    expect(indiceAbiertoTrasReordenar(1, 3, 1)).toBe(2);
  });
  it("deja igual las que no se tocan y null", () => {
    expect(indiceAbiertoTrasReordenar(3, 0, 2)).toBe(3);
    expect(indiceAbiertoTrasReordenar(null, 0, 2)).toBeNull();
  });
});
