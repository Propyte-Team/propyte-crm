import { describe, it, expect, vi, beforeEach } from "vitest";

const connectorFindUnique = vi.fn();
const brandFindFirst = vi.fn();
const convFindFirst = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    leadConnector: { findUnique: (...a: unknown[]) => connectorFindUnique(...a) },
    brand: { findFirst: (...a: unknown[]) => brandFindFirst(...a) },
    conversation: { findFirst: (...a: unknown[]) => convFindFirst(...a) },
  },
}));

import { resolveBrandForConnector, resolveBrandForContact, getDefaultBrandId, isBrandScoped, __resetBrandCacheForTests } from "./resolve";

const YAX = { id: "b-yax", name: "Yaxnáh Caucel", isDefault: false, deletedAt: null };
const DEF = { id: "b-def", name: "Propyte", isDefault: true, deletedAt: null };

beforeEach(() => { vi.resetAllMocks(); __resetBrandCacheForTests(); });

describe("resolveBrandForConnector", () => {
  it("sin connectorId → default, sin tocar la DB", async () => {
    expect(await resolveBrandForConnector(null)).toEqual({ kind: "default" });
    expect(connectorFindUnique).not.toHaveBeenCalled();
  });
  it("cuenta sin brandId → default", async () => {
    connectorFindUnique.mockResolvedValue({ brandId: null });
    expect(await resolveBrandForConnector("c1")).toEqual({ kind: "default" });
    expect(brandFindFirst).not.toHaveBeenCalled();
  });
  it("cuenta con marca no predeterminada → brand", async () => {
    connectorFindUnique.mockResolvedValue({ brandId: "b-yax" });
    brandFindFirst.mockResolvedValue(YAX);
    const r = await resolveBrandForConnector("c1");
    expect(isBrandScoped(r)).toBe(true);
    expect(r).toEqual({ kind: "brand", brand: YAX });
  });
  it("cuenta apuntando a la predeterminada → default", async () => {
    connectorFindUnique.mockResolvedValue({ brandId: "b-def" });
    brandFindFirst.mockResolvedValue(DEF);
    expect(await resolveBrandForConnector("c1")).toEqual({ kind: "default" });
  });
  it("cuenta con brandId de marca borrada → unavailable (NO contestar como Propyte)", async () => {
    connectorFindUnique.mockResolvedValue({ brandId: "b-borrada" });
    brandFindFirst.mockResolvedValue(null); // el where filtra deletedAt: null
    expect(await resolveBrandForConnector("c1")).toEqual({ kind: "unavailable", brandId: "b-borrada" });
  });
  it("error leyendo la marca → unavailable", async () => {
    connectorFindUnique.mockResolvedValue({ brandId: "b-yax" });
    brandFindFirst.mockRejectedValue(new Error("db caída"));
    expect(await resolveBrandForConnector("c1")).toEqual({ kind: "unavailable", brandId: "b-yax" });
  });
  it("migración sin aplicar (P2021/P2022) al leer la cuenta → default", async () => {
    connectorFindUnique.mockRejectedValue(Object.assign(new Error("col"), { code: "P2022" }));
    expect(await resolveBrandForConnector("c1")).toEqual({ kind: "default" });
  });
  it("otro error leyendo la cuenta → unavailable con brandId desconocido", async () => {
    connectorFindUnique.mockRejectedValue(new Error("timeout"));
    expect(await resolveBrandForConnector("c1")).toEqual({ kind: "unavailable", brandId: "?" });
  });
});

describe("resolveBrandForContact", () => {
  it("usa la conversación más reciente del contacto", async () => {
    convFindFirst.mockResolvedValue({ id: "conv9", connectorId: "c1" });
    connectorFindUnique.mockResolvedValue({ brandId: "b-yax" });
    brandFindFirst.mockResolvedValue(YAX);
    const r = await resolveBrandForContact("k1");
    expect(r.conversationId).toBe("conv9");
    expect(r.resolution).toEqual({ kind: "brand", brand: YAX });
    expect(convFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { contactId: "k1" },
      orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    }));
  });
  it("sin conversaciones → default y conversationId null", async () => {
    convFindFirst.mockResolvedValue(null);
    expect(await resolveBrandForContact("k1")).toEqual({ resolution: { kind: "default" }, conversationId: null });
  });
});

describe("getDefaultBrandId", () => {
  it("devuelve el id y lo cachea", async () => {
    brandFindFirst.mockResolvedValue({ id: "b-def" });
    expect(await getDefaultBrandId()).toBe("b-def");
    expect(await getDefaultBrandId()).toBe("b-def");
    expect(brandFindFirst).toHaveBeenCalledTimes(1);
  });
  it("error → null", async () => {
    brandFindFirst.mockRejectedValue(new Error("x"));
    expect(await getDefaultBrandId()).toBeNull();
  });
});
