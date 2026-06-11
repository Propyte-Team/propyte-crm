import { describe, it, expect } from "vitest";
import { pickWinningTerritory, type TerritoryMatch } from "./territory";

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
