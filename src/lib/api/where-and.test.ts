import { describe, it, expect } from "vitest";
import { sumarAlAnd } from "./where-and";

type W = { AND?: W | W[]; assignedToId?: unknown; stage?: string };

describe("sumarAlAnd (#881)", () => {
  it("sin AND previo crea la lista", () => {
    const w: W = { assignedToId: "ase-1" };
    sumarAlAnd(w, { assignedToId: "ase-9" });
    expect(w).toEqual({ assignedToId: "ase-1", AND: [{ assignedToId: "ase-9" }] });
  });

  it("con AND en arreglo lo conserva y agrega al final", () => {
    const w: W = { AND: [{ stage: "WON" }] };
    sumarAlAnd(w, { assignedToId: "x" }, { stage: "LOST" });
    expect(w.AND).toEqual([{ stage: "WON" }, { assignedToId: "x" }, { stage: "LOST" }]);
  });

  it("con AND como objeto suelto lo envuelve sin perderlo", () => {
    const w: W = { AND: { stage: "WON" } };
    sumarAlAnd(w, { assignedToId: "x" });
    expect(w.AND).toEqual([{ stage: "WON" }, { assignedToId: "x" }]);
  });

  it("sin condiciones no toca nada", () => {
    const w: W = { assignedToId: "ase-1" };
    sumarAlAnd(w);
    expect(w).toEqual({ assignedToId: "ase-1" });
  });
});
