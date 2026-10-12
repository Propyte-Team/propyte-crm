// Lecturas del filtro «Marca» y del contexto de badges (2026-10-12, entrega 3).
import { describe, it, expect, vi, beforeEach } from "vitest";

const brandFindFirst = vi.fn();
const brandFindMany = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    brand: {
      findFirst: (...a: unknown[]) => brandFindFirst(...a),
      findMany: (...a: unknown[]) => brandFindMany(...a),
    },
  },
}));
const getVisibleBrands = vi.fn();
vi.mock("./user-access", () => ({ getVisibleBrands: (...a: unknown[]) => getVisibleBrands(...a) }));

import { loadBrandFilter, getBrandViewContext } from "./view-context";

const SOLO_PROPYTE = { brandIds: ["b-def"], includesDefault: true };

beforeEach(() => {
  vi.resetAllMocks();
});

describe("loadBrandFilter", () => {
  it("sin marca pedida no consulta la base", async () => {
    expect(await loadBrandFilter(null, SOLO_PROPYTE)).toEqual({ kind: "none" });
    expect(await loadBrandFilter("", SOLO_PROPYTE)).toEqual({ kind: "none" });
    expect(brandFindFirst).not.toHaveBeenCalled();
  });

  it("basura no llega a la base", async () => {
    expect(await loadBrandFilter("a b c", SOLO_PROPYTE)).toEqual({ kind: "invalid" });
    expect(brandFindFirst).not.toHaveBeenCalled();
  });

  it("busca solo marcas vivas", async () => {
    brandFindFirst.mockResolvedValue({ id: "b-def", isDefault: true });
    expect(await loadBrandFilter("b-def", SOLO_PROPYTE)).toEqual({
      kind: "brand",
      filter: { brandId: "b-def", isDefault: true },
    });
    expect(brandFindFirst).toHaveBeenCalledWith({
      where: { id: "b-def", deletedAt: null },
      select: { id: true, isDefault: true },
    });
  });

  it("marca ajena e inexistente dan lo mismo", async () => {
    brandFindFirst.mockResolvedValueOnce({ id: "b-yax", isDefault: false });
    const ajena = await loadBrandFilter("b-yax", SOLO_PROPYTE);
    brandFindFirst.mockResolvedValueOnce(null);
    const inexistente = await loadBrandFilter("b-nada", SOLO_PROPYTE);
    expect(ajena).toEqual({ kind: "invalid" });
    expect(inexistente).toEqual(ajena);
  });
});

describe("getBrandViewContext", () => {
  it("arma opciones con la visibilidad del usuario y nombres de todas las vivas", async () => {
    getVisibleBrands.mockResolvedValue(SOLO_PROPYTE);
    brandFindMany.mockResolvedValue([
      { id: "b-def", name: "Propyte", isDefault: true },
      { id: "b-yax", name: "Yaxnáh Caucel", isDefault: false },
    ]);
    const ctx = await getBrandViewContext({ id: "u1", role: "GERENTE" });
    expect(ctx.options.map((b) => b.id)).toEqual(["b-def"]);
    expect(ctx.brands).toHaveLength(2);
    expect(ctx.multiBrand).toBe(false);
    expect(brandFindMany.mock.calls[0][0].where).toEqual({ deletedAt: null });
  });

  it("si falla la lectura, la pantalla sale sin badges ni selector (no se cae)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    getVisibleBrands.mockRejectedValue(new Error("db caída"));
    brandFindMany.mockResolvedValue([]);
    expect(await getBrandViewContext({ id: "u1", role: "GERENTE" })).toEqual({
      brands: [],
      options: [],
      multiBrand: false,
    });
  });
});
