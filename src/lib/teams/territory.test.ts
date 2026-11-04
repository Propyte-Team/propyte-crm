import { describe, it, expect } from "vitest";
import { vi, beforeEach } from "vitest";
import type { Contact } from "@prisma/client";

const db = vi.hoisted(() => ({
  territoryRule: { findMany: vi.fn() },
  territory: { findMany: vi.fn(), findUnique: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ default: db }));

import {
  pickWinningTerritory,
  normalizarZona,
  coincideZona,
  resolveTerritoryForContact,
  ZONE_MATCH_PRIORITY,
  type TerritoryMatch,
} from "./territory";

const m = (id: string, depth: number, priority: number): TerritoryMatch => ({
  territoryId: id,
  territoryName: id,
  depth,
  priority,
  memberUserIds: [],
});

describe("pickWinningTerritory (hijo antes que padre)", () => {
  it("gana el territorio más profundo", () => {
    expect(pickWinningTerritory([m("tulum", 1, 100), m("riviera", 0, 10)])?.territoryId).toBe("tulum");
  });
  it("empate de profundidad → menor priority", () => {
    expect(pickWinningTerritory([m("a", 1, 200), m("b", 1, 50)])?.territoryId).toBe("b");
  });
  it("sin matches → null", () => {
    expect(pickWinningTerritory([])).toBeNull();
  });
  it("no muta el array de entrada", () => {
    const arr = [m("a", 0, 1), m("b", 2, 1)];
    pickWinningTerritory(arr);
    expect(arr[0].territoryId).toBe("a");
  });
});

describe("normalizarZona / coincideZona", () => {
  it("normaliza minúsculas, acentos y espacios", () => {
    expect(normalizarZona("  Aldea  Zamá ")).toBe("aldea zama");
    expect(normalizarZona(null)).toBe("");
  });
  it("coincide sin importar mayúsculas ni acentos", () => {
    expect(coincideZona(["Aldea Zama", "Centro"], "aldea zama")).toBe(true);
    expect(coincideZona(["Aldea Zamá"], "ALDEA ZAMA")).toBe(true);
  });
  it("no coincide con zona vacía, nula o lista vacía", () => {
    expect(coincideZona(["Centro"], "Tulum")).toBe(false);
    expect(coincideZona(["Centro"], null)).toBe(false);
    expect(coincideZona(["Centro"], "  ")).toBe(false);
    expect(coincideZona([], "Centro")).toBe(false);
  });
});

describe("resolveTerritoryForContact · zonas implícitas", () => {
  const member = [{ userId: "u1", user: { isActive: true } }];
  const contact = (o: Record<string, unknown>) =>
    ({ id: "c1", score: 0, preferredZone: null, targetPlaza: null, ...o }) as unknown as Contact;
  const zonaTerr = (o: Record<string, unknown> = {}) => ({
    id: "t1", name: "Tulum", plaza: null, zones: ["Aldea Zama"], members: member, ...o,
  });

  beforeEach(() => {
    vi.resetAllMocks();
    db.territoryRule.findMany.mockResolvedValue([]);
    db.territory.findMany.mockResolvedValue([]);
    db.territory.findUnique.mockResolvedValue({ parentTerritoryId: null });
  });

  it("sin territorios ni reglas → null", async () => {
    expect(await resolveTerritoryForContact(contact({ preferredZone: "x" }))).toBeNull();
  });
  it("match por zona sin plaza en el territorio", async () => {
    db.territory.findMany.mockResolvedValue([zonaTerr()]);
    const r = await resolveTerritoryForContact(contact({ preferredZone: "aldea zama" }));
    expect(r?.territoryId).toBe("t1");
    expect(r?.priority).toBe(ZONE_MATCH_PRIORITY);
    expect(r?.memberUserIds).toEqual(["u1"]);
  });
  it("con plaza: coincide si es la misma, no si difiere, y no bloquea si el contacto no tiene plaza", async () => {
    db.territory.findMany.mockResolvedValue([zonaTerr({ plaza: "TULUM" })]);
    expect(await resolveTerritoryForContact(contact({ preferredZone: "Aldea Zama", targetPlaza: "TULUM" }))).not.toBeNull();
    expect(await resolveTerritoryForContact(contact({ preferredZone: "Aldea Zama", targetPlaza: "MERIDA" }))).toBeNull();
    expect(await resolveTerritoryForContact(contact({ preferredZone: "Aldea Zama" }))).not.toBeNull();
  });
  it("regla explícita del mismo territorio gana sobre la zona", async () => {
    db.territoryRule.findMany.mockResolvedValue([
      { priority: 100, conditions: [], territory: { id: "t1", name: "Tulum", members: member } },
    ]);
    db.territory.findMany.mockResolvedValue([zonaTerr()]);
    const spy = vi.spyOn(await import("@/lib/workflows/evaluate-conditions"), "evaluateConditions").mockReturnValue(true);
    const r = await resolveTerritoryForContact(contact({ preferredZone: "Aldea Zama" }));
    spy.mockRestore();
    expect(r?.priority).toBe(100);
  });
  it("sin zonas no hay match implícito", async () => {
    db.territory.findMany.mockResolvedValue([zonaTerr({ zones: [] })]);
    expect(await resolveTerritoryForContact(contact({ preferredZone: "Aldea Zama" }))).toBeNull();
  });
});
