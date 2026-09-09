import { describe, it, expect } from "vitest";

// Tarjeta #745, la segunda mitad: los filtros del listado de unidades.
//
// `where.status = status as any` y `where.unitType = unitType as any` dejaban entrar
// cualquier cosa (⇒ 500 de Prisma), y `parseFloat(minPrice)` metía `gte: NaN` en el filtro
// sin fallar, lo cual es peor: el listado contestaba —normalmente vacío— sin avisar.

import {
  valorDeEnum,
  numeroNoNegativo,
  ESTADOS_DE_UNIDAD,
  TIPOS_DE_UNIDAD,
} from "./filtros";

describe("valorDeEnum (#745)", () => {
  it("ausente o vacío es undefined, o sea: no filtrar", () => {
    expect(valorDeEnum("status", ESTADOS_DE_UNIDAD, null)).toEqual({ valor: undefined });
    expect(valorDeEnum("status", ESTADOS_DE_UNIDAD, "")).toEqual({ valor: undefined });
    expect(valorDeEnum("status", ESTADOS_DE_UNIDAD, undefined)).toEqual({ valor: undefined });
  });

  it("deja pasar los valores del enum", () => {
    expect(valorDeEnum("status", ESTADOS_DE_UNIDAD, "APARTADA")).toEqual({ valor: "APARTADA" });
    expect(valorDeEnum("unitType", TIPOS_DE_UNIDAD, "PENTHOUSE")).toEqual({ valor: "PENTHOUSE" });
  });

  it("rechaza un valor fuera del enum y nombra el parámetro", () => {
    const r = valorDeEnum("status", ESTADOS_DE_UNIDAD, "VENDIDO");

    expect(r.valor).toBeUndefined();
    expect(r.error).toContain("status");
    expect(r.error).toContain("VENDIDO");
    // Y dice cuáles sí valen, para que quien integra no adivine.
    expect(r.error).toContain("DISPONIBLE");
  });

  it("distingue mayúsculas: los enums de Prisma van en mayúsculas", () => {
    expect(valorDeEnum("status", ESTADOS_DE_UNIDAD, "disponible").error).toBeTruthy();
  });
});

describe("numeroNoNegativo (#745)", () => {
  it("ausente o vacío es undefined", () => {
    expect(numeroNoNegativo("minPrice", null)).toEqual({ valor: undefined });
    expect(numeroNoNegativo("minPrice", "")).toEqual({ valor: undefined });
  });

  it("convierte números válidos, incluido el cero", () => {
    expect(numeroNoNegativo("minPrice", "1500000")).toEqual({ valor: 1_500_000 });
    expect(numeroNoNegativo("minPrice", "1500000.75")).toEqual({ valor: 1_500_000.75 });
    expect(numeroNoNegativo("minPrice", "0")).toEqual({ valor: 0 });
  });

  it("rechaza lo que no es número en vez de meter NaN al filtro", () => {
    const r = numeroNoNegativo("minPrice", "abc");

    expect(r.valor).toBeUndefined();
    expect(r.error).toContain("minPrice");
  });

  it("rechaza el número a medias que parseFloat sí se tragaba", () => {
    // `parseFloat("1500000abc")` devuelve 1500000 y sigue como si nada.
    expect(numeroNoNegativo("minPrice", "1500000abc").error).toBeTruthy();
  });

  it("rechaza Infinity y los negativos", () => {
    expect(numeroNoNegativo("maxPrice", "Infinity").error).toBeTruthy();
    expect(numeroNoNegativo("minPrice", "-1").error).toBeTruthy();
  });
});

describe("los enums están sincronizados con el schema (#745)", () => {
  it("los cuatro estados y los ocho tipos de unidad", () => {
    // Si alguien agrega un valor a UnitStatus o UnitType en prisma/schema.prisma y no lo
    // agrega aquí, el filtro correspondiente deja de aceptarlo. Esta prueba es el aviso.
    expect([...ESTADOS_DE_UNIDAD]).toEqual([
      "DISPONIBLE",
      "APARTADA",
      "VENDIDA",
      "NO_DISPONIBLE",
    ]);
    expect(TIPOS_DE_UNIDAD).toHaveLength(8);
    expect(TIPOS_DE_UNIDAD).toContain("MACROLOTE");
  });
});
