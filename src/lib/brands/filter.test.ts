// Filtro «Marca» de las listas (2026-10-12, entrega 3). Lo que se prueba aquí es la regla de
// oro del dueño: el filtro solo ACOTA dentro de lo que el usuario ya ve, nunca amplía, y una marca
// desconocida o ajena se rechaza igual que una inexistente (sin delatar cuál de las dos es).
import { describe, it, expect } from "vitest";
import {
  BRAND_FILTER_PARAM,
  parseBrandFilterParam,
  resolveBrandFilter,
  contactBrandFilterWhere,
  dealBrandFilterWhere,
  conversationBrandFilterWhere,
} from "./filter";
import type { VisibleBrands } from "./visibility";

const PROPYTE = { id: "b-def", isDefault: true };
const YAXNAH = { id: "b-yax", isDefault: false };

const SOLO_PROPYTE: VisibleBrands = { brandIds: ["b-def"], includesDefault: true };
const PROPYTE_Y_YAXNAH: VisibleBrands = { brandIds: ["b-def", "b-yax"], includesDefault: true };
const SOLO_YAXNAH: VisibleBrands = { brandIds: ["b-yax"], includesDefault: false };
// Sin filas y sin poder leer el id de la predeterminada (visibility.ts §includesDefault).
const SIN_ID_PREDETERMINADA: VisibleBrands = { brandIds: [], includesDefault: true };

describe("parseBrandFilterParam", () => {
  it("el parámetro se llama «marca», como el resto de filtros en español de la URL", () => {
    expect(BRAND_FILTER_PARAM).toBe("marca");
  });

  it("vacío o ausente = «Todas mis marcas»", () => {
    expect(parseBrandFilterParam(null)).toEqual({ kind: "none" });
    expect(parseBrandFilterParam(undefined)).toEqual({ kind: "none" });
    expect(parseBrandFilterParam("")).toEqual({ kind: "none" });
    expect(parseBrandFilterParam("   ")).toEqual({ kind: "none" });
  });

  it("un id con forma de id se acepta (sin espacios)", () => {
    expect(parseBrandFilterParam(" b-yax ")).toEqual({ kind: "id", brandId: "b-yax" });
    expect(parseBrandFilterParam("9f1c2a4e-1b2c-4d5e-8f90-1234567890ab")).toEqual({
      kind: "id",
      brandId: "9f1c2a4e-1b2c-4d5e-8f90-1234567890ab",
    });
  });

  it("basura (caracteres raros, demasiado largo) es inválido sin consultar la base", () => {
    expect(parseBrandFilterParam("'; drop table brands")).toEqual({ kind: "invalid" });
    expect(parseBrandFilterParam("x".repeat(65))).toEqual({ kind: "invalid" });
  });
});

describe("resolveBrandFilter — nunca amplía", () => {
  it("sin marca pedida no hay filtro", () => {
    expect(resolveBrandFilter(null, null, SOLO_PROPYTE)).toEqual({ kind: "none" });
  });

  it("marca inexistente o borrada (no vino de la base) → inválida", () => {
    expect(resolveBrandFilter("b-nada", null, SOLO_PROPYTE)).toEqual({ kind: "invalid" });
    expect(resolveBrandFilter("b-nada", null, "ALL")).toEqual({ kind: "invalid" });
  });

  it("una marca que el usuario NO ve → inválida, igual que una que no existe", () => {
    const ajena = resolveBrandFilter("b-yax", YAXNAH, SOLO_PROPYTE);
    const inexistente = resolveBrandFilter("b-nada", null, SOLO_PROPYTE);
    expect(ajena).toEqual({ kind: "invalid" });
    expect(ajena).toEqual(inexistente);
  });

  it("una marca que sí ve → filtro", () => {
    expect(resolveBrandFilter("b-yax", YAXNAH, PROPYTE_Y_YAXNAH)).toEqual({
      kind: "brand",
      filter: { brandId: "b-yax", isDefault: false },
    });
  });

  it("ADMIN (ALL) puede filtrar por cualquier marca viva", () => {
    expect(resolveBrandFilter("b-yax", YAXNAH, "ALL")).toEqual({
      kind: "brand",
      filter: { brandId: "b-yax", isDefault: false },
    });
  });

  it("la predeterminada: con Propyte apagada es ajena", () => {
    expect(resolveBrandFilter("b-def", PROPYTE, SOLO_YAXNAH)).toEqual({ kind: "invalid" });
  });

  it("la predeterminada: vale por includesDefault aunque su id no esté en brandIds", () => {
    expect(resolveBrandFilter("b-def", PROPYTE, SIN_ID_PREDETERMINADA)).toEqual({
      kind: "brand",
      filter: { brandId: "b-def", isDefault: true },
    });
  });

  it("si la base devolvió otra fila que la pedida, no se confía en ella", () => {
    expect(resolveBrandFilter("b-yax", PROPYTE, "ALL")).toEqual({ kind: "invalid" });
  });
});

describe("where del filtro", () => {
  it("marca NO predeterminada: contactos con una fila de esa marca", () => {
    expect(contactBrandFilterWhere({ brandId: "b-yax", isDefault: false })).toEqual({
      brands: { some: { brandId: "b-yax" } },
    });
  });

  it("predeterminada: contactos SIN filas o con una fila de la predeterminada", () => {
    expect(contactBrandFilterWhere({ brandId: "b-def", isDefault: true })).toEqual({
      OR: [{ brands: { none: {} } }, { brands: { some: { brandId: "b-def" } } }],
    });
  });

  it("el filtro de contacto NO trae el término «asignado a mí»: acotar no es ver", () => {
    const w = JSON.stringify(contactBrandFilterWhere({ brandId: "b-yax", isDefault: false }));
    expect(w).not.toContain("assignedToId");
  });

  it("negocios: por la marca de su contacto", () => {
    expect(dealBrandFilterWhere({ brandId: "b-yax", isDefault: false })).toEqual({
      contact: { brands: { some: { brandId: "b-yax" } } },
    });
  });

  it("conversaciones: por la marca de la CUENTA del hilo (un contacto puede tener hilos en dos marcas)", () => {
    expect(conversationBrandFilterWhere({ brandId: "b-yax", isDefault: false })).toEqual({
      connector: { is: { brandId: "b-yax" } },
    });
  });

  it("conversaciones de la predeterminada: sin cuenta, cuenta sin marca o cuenta de la predeterminada", () => {
    expect(conversationBrandFilterWhere({ brandId: "b-def", isDefault: true })).toEqual({
      OR: [
        { connectorId: null },
        { connector: { is: { brandId: null } } },
        { connector: { is: { brandId: "b-def" } } },
      ],
    });
  });
});
