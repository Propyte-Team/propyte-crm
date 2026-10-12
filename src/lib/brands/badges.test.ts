// Badge de marca en listas y fichas (2026-10-12, entrega 3, decisión 2 del dueño).
import { describe, it, expect } from "vitest";
import { brandBadges, buildBrandViewContext, EMPTY_BRAND_VIEW, type BrandLite } from "./badges";

const PROPYTE: BrandLite = { id: "b-def", name: "Propyte", isDefault: true };
const YAXNAH: BrandLite = { id: "b-yax", name: "Yaxnáh Caucel", isDefault: false };
const AVICA: BrandLite = { id: "b-avi", name: "Avica", isDefault: false };
// Orden de la base: la predeterminada primero y luego por nombre.
const VIVAS = [PROPYTE, AVICA, YAXNAH];

describe("buildBrandViewContext", () => {
  it("ADMIN (ALL): elige entre todas las marcas vivas y ve más de una", () => {
    const ctx = buildBrandViewContext(VIVAS, "ALL");
    expect(ctx.options).toEqual(VIVAS);
    expect(ctx.multiBrand).toBe(true);
    expect(ctx.brands).toEqual(VIVAS);
  });

  it("usuario sin filas: solo la predeterminada → no es multimarca", () => {
    const ctx = buildBrandViewContext(VIVAS, { brandIds: ["b-def"], includesDefault: true });
    expect(ctx.options).toEqual([PROPYTE]);
    expect(ctx.multiBrand).toBe(false);
    // los nombres de TODAS las vivas siguen disponibles para nombrar lo asignado de otra marca
    expect(ctx.brands).toEqual(VIVAS);
  });

  it("Propyte + Yaxnáh: dos opciones, en el orden de la base", () => {
    const ctx = buildBrandViewContext(VIVAS, { brandIds: ["b-yax", "b-def"], includesDefault: true });
    expect(ctx.options).toEqual([PROPYTE, YAXNAH]);
    expect(ctx.multiBrand).toBe(true);
  });

  it("la predeterminada entra por includesDefault aunque su id no venga en brandIds", () => {
    const ctx = buildBrandViewContext(VIVAS, { brandIds: [], includesDefault: true });
    expect(ctx.options).toEqual([PROPYTE]);
  });

  it("una marca borrada (ya no está entre las vivas) no se ofrece", () => {
    const ctx = buildBrandViewContext([PROPYTE], { brandIds: ["b-def", "b-yax"], includesDefault: true });
    expect(ctx.options).toEqual([PROPYTE]);
    expect(ctx.multiBrand).toBe(false);
  });

  it("ADMIN con una sola marca viva no es multimarca (no hay nada que distinguir)", () => {
    expect(buildBrandViewContext([PROPYTE], "ALL").multiBrand).toBe(false);
  });
});

describe("brandBadges", () => {
  const soloPropyte = buildBrandViewContext(VIVAS, { brandIds: ["b-def"], includesDefault: true });
  const multimarca = buildBrandViewContext(VIVAS, "ALL");

  it("quien ve una sola marca: un contacto solo de la predeterminada NO lleva badge (ruido)", () => {
    expect(brandBadges([], soloPropyte)).toEqual([]);
    expect(brandBadges(["b-def"], soloPropyte)).toEqual([]);
  });

  it("quien ve varias marcas: también se pinta la predeterminada, para distinguirla", () => {
    expect(brandBadges([], multimarca)).toEqual([PROPYTE]);
    expect(brandBadges(["b-def"], multimarca)).toEqual([PROPYTE]);
  });

  it("una marca NO predeterminada se pinta siempre (llega por asignación a quien solo ve Propyte)", () => {
    expect(brandBadges(["b-yax"], soloPropyte)).toEqual([YAXNAH]);
  });

  it("contacto en dos marcas: se pintan las dos, en el orden de la base y sin duplicados", () => {
    expect(brandBadges(["b-yax", "b-def", "b-yax"], soloPropyte)).toEqual([PROPYTE, YAXNAH]);
  });

  it("filas de marcas borradas no se pintan; si no queda ninguna, nada", () => {
    expect(brandBadges(["b-borrada"], multimarca)).toEqual([]);
    expect(brandBadges(["b-borrada", "b-yax"], multimarca)).toEqual([YAXNAH]);
  });

  it("registro leído sin marcas (null/undefined): no se adivina", () => {
    expect(brandBadges(null, multimarca)).toEqual([]);
    expect(brandBadges(undefined, multimarca)).toEqual([]);
  });

  it("alreadyShown: no repite la marca que la etiqueta de la cuenta ya muestra (bandeja)", () => {
    expect(brandBadges(["b-yax"], multimarca, { alreadyShown: "Yaxnáh Caucel" })).toEqual([]);
    expect(brandBadges([], multimarca, { alreadyShown: "Nativa tulum" })).toEqual([PROPYTE]);
  });

  it("sin contexto (no se pudo leer): nunca pinta nada", () => {
    expect(brandBadges(["b-yax"], EMPTY_BRAND_VIEW)).toEqual([]);
    expect(EMPTY_BRAND_VIEW.options).toEqual([]);
  });
});
