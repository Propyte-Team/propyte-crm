import { describe, it, expect } from "vitest";

// Tarjeta #745 · AUD-20260903 D-11 (ampliado a 5 rutas en el repaso del 2026-09-08).
//
// Antes, `sortBy` y `sortOrder` viajaban crudos del query string a
// `orderBy: { [sortBy]: sortOrder }`. Un valor inventado, o simplemente mal escrito,
// hacía que Prisma lanzara PrismaClientValidationError y la ruta contestara 500.

import { ordenValidado, ORDEN_POR_ENTIDAD, SENTIDOS_DE_ORDEN } from "./orden";

describe("ordenValidado — valores por defecto (#745)", () => {
  it("sin parámetros usa el orden que cada listado ya tenía", () => {
    expect(ordenValidado("contact")).toEqual({ orderBy: { createdAt: "desc" } });
    expect(ordenValidado("deal")).toEqual({ orderBy: { createdAt: "desc" } });
    expect(ordenValidado("activity")).toEqual({ orderBy: { createdAt: "desc" } });
    // Unidades ordenaba por número, ascendente: se conserva.
    expect(ordenValidado("unit")).toEqual({ orderBy: { unitNumber: "asc" } });
  });

  it("una cadena vacía cuenta como ausente, no como columna inválida", () => {
    expect(ordenValidado("deal", "", "")).toEqual({ orderBy: { createdAt: "desc" } });
    expect(ordenValidado("deal", "   ", "  ")).toEqual({ orderBy: { createdAt: "desc" } });
  });
});

describe("ordenValidado — columna (#745)", () => {
  it("acepta una columna de la lista blanca", () => {
    expect(ordenValidado("unit", "price", "desc")).toEqual({ orderBy: { price: "desc" } });
    expect(ordenValidado("deal", "estimatedValue", "asc")).toEqual({
      orderBy: { estimatedValue: "asc" },
    });
  });

  it("rechaza una columna inventada y dice cuáles valen", () => {
    const r = ordenValidado("deal", "noExiste");

    expect(r.orderBy).toBeUndefined();
    expect(r.error).toContain("noExiste");
    expect(r.error).toContain("createdAt");
  });

  it("rechaza columnas que existen en la tabla pero el listado no expone", () => {
    // `custom` es un Json y `zohoId` es interno: ordenar por ellos nunca fue la intención,
    // solo era posible porque el nombre iba libre.
    expect(ordenValidado("deal", "custom").error).toBeTruthy();
    expect(ordenValidado("contact", "zohoId").error).toBeTruthy();
    expect(ordenValidado("deal", "commissionTotal").error).toBeTruthy();
  });

  it("no deja pasar una columna de OTRA entidad", () => {
    // `unitNumber` es de unidades; en el listado de negocios reventaría igual.
    expect(ordenValidado("deal", "unitNumber").error).toBeTruthy();
    expect(ordenValidado("unit", "estimatedValue").error).toBeTruthy();
  });
});

describe("ordenValidado — sentido (#745)", () => {
  it("acepta asc y desc", () => {
    expect(ordenValidado("contact", "score", "asc")).toEqual({ orderBy: { score: "asc" } });
    expect(ordenValidado("contact", "score", "desc")).toEqual({ orderBy: { score: "desc" } });
  });

  it("rechaza ascending, que es el error de dedo típico", () => {
    const r = ordenValidado("contact", "score", "ascending");

    expect(r.orderBy).toBeUndefined();
    expect(r.error).toContain("ascending");
  });

  it("distingue mayúsculas: DESC no es desc", () => {
    // Prisma solo acepta las minúsculas; aceptar "DESC" aquí sería mentir.
    expect(ordenValidado("contact", "score", "DESC").error).toBeTruthy();
  });
});

describe("la tabla de listas blancas es coherente (#745)", () => {
  it("la columna por defecto de cada entidad está en su propia lista", () => {
    for (const [entidad, cfg] of Object.entries(ORDEN_POR_ENTIDAD)) {
      expect(
        (cfg.columnas as readonly string[]).includes(cfg.porDefecto),
        `${entidad}: la columna por defecto "${cfg.porDefecto}" no está en su lista`
      ).toBe(true);
      expect(SENTIDOS_DE_ORDEN).toContain(cfg.sentidoPorDefecto);
    }
  });

  it("ninguna lista está vacía ni tiene columnas repetidas", () => {
    for (const [entidad, cfg] of Object.entries(ORDEN_POR_ENTIDAD)) {
      const columnas = cfg.columnas as readonly string[];
      expect(columnas.length, `${entidad}: lista vacía`).toBeGreaterThan(0);
      expect(new Set(columnas).size, `${entidad}: columnas repetidas`).toBe(columnas.length);
    }
  });
});
