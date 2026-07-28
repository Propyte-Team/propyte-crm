import { describe, it, expect, vi, beforeEach } from "vitest";

const queryRaw = vi.fn().mockResolvedValue([]);
vi.mock("@/lib/db", () => ({
  default: { $queryRawUnsafe: (...a: unknown[]) => queryRaw(...a) },
}));

import { PUBLIC_GATE } from "./catalog";
import { listHubDevelopments, getHubDevelopment, listHubUnits, getHubUnit } from "./client";

function lastSql(): string {
  return String(queryRaw.mock.calls[queryRaw.mock.calls.length - 1][0]);
}

beforeEach(() => {
  queryRaw.mockClear();
  queryRaw.mockResolvedValue([]);
});

describe("client.ts usa el mismo gate que el sitio", () => {
  it("listHubDevelopments ya no filtra por pipeline_status", async () => {
    await listHubDevelopments();
    expect(lastSql()).toContain(PUBLIC_GATE);
    expect(lastSql()).not.toContain("pipeline_status");
  });

  it("listHubUnits usa el gate público", async () => {
    await listHubUnits({});
    expect(lastSql()).toContain(PUBLIC_GATE);
  });
});

describe("firmas legadas intactas", () => {
  it("listHubDevelopments devuelve un array, no un CatalogResult", async () => {
    const res = await listHubDevelopments();
    expect(Array.isArray(res)).toBe(true);
  });

  it("ante fallo devuelve [] para no romper a los callers", async () => {
    queryRaw.mockRejectedValueOnce(new Error("db caída"));
    const res = await listHubDevelopments();
    expect(res).toEqual([]);
  });

  it("getHubDevelopment devuelve null cuando no hay fila", async () => {
    expect(await getHubDevelopment("x")).toBeNull();
  });

  it("getHubUnit mapea al shape legado HubUnit", async () => {
    queryRaw.mockResolvedValueOnce([
      { id: "u1", developmentId: "d1", unitNumber: "101", title: "PH", unitType: "Depa",
        typology: "2R", bedrooms: 2, bathrooms: 2, builtAreaM2: 90, areaM2: 100,
        priceMxn: 4_000_000, priceUsd: null, currency: "MXN", status: "disponible" },
    ]);
    const u = await getHubUnit("u1");
    expect(u).toMatchObject({
      id: "u1", developmentId: "d1", numero: "101", recamaras: 2,
      m2Construccion: 90, precioMxn: 4_000_000, moneda: "MXN",
    });
  });
});
