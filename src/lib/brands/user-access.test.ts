// Carga de las marcas que ve un usuario (2026-10-12, spec marcas-visibilidad).
import { describe, it, expect, vi, beforeEach } from "vitest";

const accessFindMany = vi.fn();
vi.mock("@/lib/db", () => ({
  default: { userBrandAccess: { findMany: (...a: unknown[]) => accessFindMany(...a) } },
}));
const getDefaultBrandId = vi.fn();
vi.mock("./resolve", () => ({ getDefaultBrandId: () => getDefaultBrandId() }));

import { getVisibleBrands } from "./user-access";

beforeEach(() => {
  vi.resetAllMocks();
  getDefaultBrandId.mockResolvedValue("b-def");
});

describe("getVisibleBrands", () => {
  it("ADMIN → ALL sin consultar la base", async () => {
    expect(await getVisibleBrands({ id: "a1", role: "ADMIN" })).toBe("ALL");
    expect(accessFindMany).not.toHaveBeenCalled();
    expect(getDefaultBrandId).not.toHaveBeenCalled();
  });

  it("sin filas → solo la predeterminada", async () => {
    accessFindMany.mockResolvedValue([]);
    expect(await getVisibleBrands({ id: "u1", role: "GERENTE" })).toEqual({
      brandIds: ["b-def"],
      includesDefault: true,
    });
    expect(accessFindMany).toHaveBeenCalledWith({
      where: { userId: "u1" },
      select: { brandId: true, brand: { select: { isDefault: true, deletedAt: true } } },
    });
  });

  it("con filas no necesita leer la predeterminada (la trae isDefault)", async () => {
    accessFindMany.mockResolvedValue([
      { brandId: "b-def", brand: { isDefault: true, deletedAt: null } },
      { brandId: "b-yax", brand: { isDefault: false, deletedAt: null } },
    ]);
    expect(await getVisibleBrands({ id: "u1", role: "DIRECTOR" })).toEqual({
      brandIds: ["b-def", "b-yax"],
      includesDefault: true,
    });
    expect(getDefaultBrandId).not.toHaveBeenCalled();
  });

  it("migración sin aplicar (P2021) → como sin filas: solo la predeterminada", async () => {
    accessFindMany.mockRejectedValue(Object.assign(new Error("no table"), { code: "P2021" }));
    expect(await getVisibleBrands({ id: "u1", role: "ASESOR" })).toEqual({
      brandIds: ["b-def"],
      includesDefault: true,
    });
  });

  it("cualquier otro error se propaga: no se adivina un conjunto que podría ser más amplio", async () => {
    accessFindMany.mockRejectedValue(new Error("db caída"));
    await expect(getVisibleBrands({ id: "u1", role: "ASESOR" })).rejects.toThrow("db caída");
  });
});
