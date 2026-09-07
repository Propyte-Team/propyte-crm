import { describe, it, expect } from "vitest";
import { deltasParaEtapa, deltasAPrisma } from "./stage-inventory";

// Auditoría 2026-09-03 #D-02. Los contadores de `Development` se movían mirando sólo la
// etapa destino, sin comparar con la anterior ni con el estado de la unidad. De ahí las
// dos formas de dejar el inventario en números imposibles que se prueban aquí.

describe("deltasParaEtapa — RESERVED", () => {
  it("mueve disponible a apartada cuando la unidad estaba disponible", () => {
    expect(deltasParaEtapa("RESERVED", "DISPONIBLE")).toEqual({
      reservedUnits: 1,
      availableUnits: -1,
    });
  });

  it("no mueve nada si la unidad ya estaba apartada", () => {
    // El doble clic: antes esto sumaba una reserva y restaba un disponible por segunda
    // vez, y el desarrollo quedaba con más apartadas de las que tiene.
    expect(deltasParaEtapa("RESERVED", "APARTADA")).toBeNull();
  });

  it("no mueve nada sobre una unidad vendida o no disponible", () => {
    expect(deltasParaEtapa("RESERVED", "VENDIDA")).toBeNull();
    expect(deltasParaEtapa("RESERVED", "NO_DISPONIBLE")).toBeNull();
    expect(deltasParaEtapa("RESERVED", null)).toBeNull();
  });
});

describe("deltasParaEtapa — WON", () => {
  it("de apartada a vendida: descuenta de apartadas", () => {
    expect(deltasParaEtapa("WON", "APARTADA")).toEqual({
      soldUnits: 1,
      reservedUnits: -1,
    });
  });

  it("salto de etapa: si nunca se apartó, descuenta de disponibles, no de apartadas", () => {
    // El caso que dejaba el contador negativo para siempre: NEGOTIATION → WON, que
    // ninguna regla impide, hacía `reservedUnits - 1` sobre un negocio que nunca
    // reservó. Y además `availableUnits` quedaba sobrestimado, porque la unidad se
    // vendió pero nadie la sacó de disponibles.
    expect(deltasParaEtapa("WON", "DISPONIBLE")).toEqual({
      soldUnits: 1,
      availableUnits: -1,
    });
  });

  it("no vuelve a contar una unidad ya vendida", () => {
    expect(deltasParaEtapa("WON", "VENDIDA")).toBeNull();
  });
});

describe("deltasParaEtapa — invariante", () => {
  it("ningún movimiento cambia el total de unidades del desarrollo", () => {
    const casos = [
      deltasParaEtapa("RESERVED", "DISPONIBLE"),
      deltasParaEtapa("WON", "APARTADA"),
      deltasParaEtapa("WON", "DISPONIBLE"),
    ];

    for (const deltas of casos) {
      const suma = Object.values(deltas!).reduce((a, b) => a + b, 0);
      expect(suma).toBe(0);
    }
  });
});

describe("deltasAPrisma", () => {
  it("traduce signos a increment y decrement", () => {
    expect(deltasAPrisma({ soldUnits: 1, reservedUnits: -1 })).toEqual({
      soldUnits: { increment: 1 },
      reservedUnits: { decrement: 1 },
    });
  });

  it("omite los ceros en vez de escribir un incremento vacío", () => {
    expect(deltasAPrisma({ soldUnits: 1, availableUnits: 0 })).toEqual({
      soldUnits: { increment: 1 },
    });
  });
});
