import { describe, it, expect } from "vitest";
import { layoutFlow, TAMANOS_NODO } from "./layout";
import type { Flow, RFNode } from "./flow-adapter";

const n = (id: string, type = "action"): RFNode => ({ id, type, position: { x: 0, y: 0 }, data: {} });
const e = (source: string, target: string) => ({ id: `${source}->${target}`, source, target });
const pos = (f: Flow, id: string) => f.nodes.find((x) => x.id === id)!.position;

describe("layoutFlow", () => {
  it("flujo vacío → vacío", () => {
    expect(layoutFlow({ nodes: [], edges: [] })).toEqual({ nodes: [], edges: [] });
  });

  it("una cadena baja: y estrictamente creciente y misma x", () => {
    const f = layoutFlow({ nodes: [n("t", "trigger"), n("a"), n("b"), n("c")], edges: [e("t", "a"), e("a", "b"), e("b", "c")] });
    const ys = ["t", "a", "b", "c"].map((id) => pos(f, id).y);
    expect(ys).toEqual([...ys].sort((x, y) => x - y));
    expect(new Set(ys).size).toBe(4);
    expect(new Set(["t", "a", "b", "c"].map((id) => pos(f, id).x)).size).toBe(1);
  });

  it("no encima los nodos: separa por la altura de cada tipo", () => {
    const f = layoutFlow({ nodes: [n("t", "trigger"), n("a")], edges: [e("t", "a")] });
    expect(pos(f, "a").y - pos(f, "t").y).toBeGreaterThanOrEqual(TAMANOS_NODO.trigger.height);
  });

  it("las ramas de una decisión quedan lado a lado (misma y, distinta x)", () => {
    const f = layoutFlow({
      nodes: [n("t", "trigger"), n("d", "decision"), n("si"), n("no")],
      edges: [e("t", "d"), e("d", "si"), e("d", "no")],
    });
    expect(pos(f, "si").y).toBe(pos(f, "no").y);
    expect(pos(f, "si").x).not.toBe(pos(f, "no").x);
    expect(pos(f, "si").y).toBeGreaterThan(pos(f, "d").y);
    expect(Math.abs(pos(f, "si").x - pos(f, "no").x)).toBeGreaterThanOrEqual(TAMANOS_NODO.action.width);
  });

  it("rama vacía: el marcador de «no hace nada» ocupa su lugar junto a la otra rama", () => {
    const f = layoutFlow({
      nodes: [n("d", "decision"), n("a"), n("v", "empty")],
      edges: [e("d", "a"), e("d", "v")],
    });
    expect(pos(f, "a").y).toBeGreaterThan(pos(f, "d").y);
    expect(pos(f, "v").y).toBeGreaterThan(pos(f, "d").y);
    expect(pos(f, "a").x).not.toBe(pos(f, "v").x);
  });

  it("decisión anidada: cada nivel queda más abajo y las ramas internas no se pisan", () => {
    const f = layoutFlow({
      nodes: [n("d1", "decision"), n("a"), n("d2", "decision"), n("b"), n("c")],
      edges: [e("d1", "a"), e("d1", "d2"), e("d2", "b"), e("d2", "c")],
    });
    expect(pos(f, "d2").y).toBeGreaterThan(pos(f, "d1").y);
    expect(pos(f, "b").y).toBeGreaterThan(pos(f, "d2").y);
    expect(pos(f, "b").y).toBe(pos(f, "c").y);
    expect(pos(f, "b").x).not.toBe(pos(f, "c").x);
  });

  it("ramas que se juntan: el paso común queda debajo de ambas", () => {
    const f = layoutFlow({
      nodes: [n("d", "decision"), n("a"), n("b"), n("fin")],
      edges: [e("d", "a"), e("d", "b"), e("a", "fin"), e("b", "fin")],
    });
    expect(pos(f, "fin").y).toBeGreaterThan(pos(f, "a").y);
  });

  it("no muta la entrada y es determinista", () => {
    const flow: Flow = { nodes: [n("t", "trigger"), n("a")], edges: [e("t", "a")] };
    const copia = JSON.parse(JSON.stringify(flow));
    const uno = layoutFlow(flow);
    expect(flow).toEqual(copia);
    expect(layoutFlow(flow)).toEqual(uno);
  });

  it("ignora aristas hacia nodos que no existen", () => {
    const f = layoutFlow({ nodes: [n("a")], edges: [e("a", "fantasma")] });
    expect(f.nodes).toHaveLength(1);
  });
});
