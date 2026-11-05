import { describe, it, expect } from "vitest";
import { applyPositions, type RFNode } from "./flow-adapter";

describe("applyPositions", () => {
  it("sobrescribe posición por nodo guardado y deja el resto en auto", () => {
    const nodes: RFNode[] = [
      { id: "a", type: "rule", position: { x: 0, y: 0 }, data: { label: "A" } },
      { id: "b", type: "rule", position: { x: 10, y: 10 }, data: { label: "B" } },
    ];
    const out = applyPositions(nodes, { a: { x: 500, y: 600 } });
    expect(out.find((n) => n.id === "a")!.position).toEqual({ x: 500, y: 600 });
    expect(out.find((n) => n.id === "b")!.position).toEqual({ x: 10, y: 10 });
  });
});
