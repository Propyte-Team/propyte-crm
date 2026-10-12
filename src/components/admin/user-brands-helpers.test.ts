import { describe, it, expect } from "vitest";
import { effectiveBrandIds, sameBrandSet, toggleBrand, type BrandOption } from "./user-brands-helpers";

const BRANDS: BrandOption[] = [
  { id: "b-def", name: "Propyte", isDefault: true },
  { id: "b-yax", name: "Yaxnáh Caucel", isDefault: false },
  { id: "b-avi", name: "Avica", isDefault: false },
];

describe("effectiveBrandIds", () => {
  it("sin filas → solo la predeterminada marcada", () => {
    expect(effectiveBrandIds(BRANDS, null)).toEqual(["b-def"]);
  });

  it("con filas → las suyas (sin la predeterminada si la apagaron)", () => {
    expect(effectiveBrandIds(BRANDS, ["b-yax"])).toEqual(["b-yax"]);
  });

  it("una fila de una marca borrada (ya no está en la lista) no se marca", () => {
    expect(effectiveBrandIds(BRANDS, ["b-def", "b-borrada"])).toEqual(["b-def"]);
  });
});

describe("sameBrandSet", () => {
  it("ignora el orden", () => {
    expect(sameBrandSet(["b-def", "b-yax"], ["b-yax", "b-def"])).toBe(true);
    expect(sameBrandSet(["b-def"], ["b-def", "b-yax"])).toBe(false);
  });
});

describe("toggleBrand", () => {
  it("prende y apaga respetando el orden de la lista", () => {
    expect(toggleBrand(BRANDS, ["b-avi"], "b-def")).toEqual(["b-def", "b-avi"]);
    expect(toggleBrand(BRANDS, ["b-def", "b-avi"], "b-def")).toEqual(["b-avi"]);
  });
});
