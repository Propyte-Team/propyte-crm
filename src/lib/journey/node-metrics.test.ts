import { describe, it, expect } from "vitest";
import { computeNodeMetrics } from "./node-metrics";
import { ruleToDraft } from "./rule-draft";

const draft = ruleToDraft({
  id: "r1", name: "x", description: null, triggerType: "EVENT", triggerConfig: {}, conditions: {},
  cooldownMinutes: null, priority: 100, isActive: true,
  actions: [
    { type: "CHANGE_STAGE", config: {} },
    { kind: "decision", label: "Por origen", branches: [
      { label: "META", conditions: {}, steps: [{ type: "ASSIGN", config: {} }] },
      { label: "WEB", conditions: {}, steps: [{ type: "NOTIFY", config: {} }] },
    ], else: [{ type: "ADD_TAG", config: {} }] },
  ],
} as never);

const raw = { total: 142, counts: { "0": 142, "1.b0.0": 96, "1.b1.0": 36, "1.else.0": 10 } };

describe("computeNodeMetrics", () => {
  it("volumen por nodo: acción = conteo exacto (ruta→nodeId con prefijo 'a')", () => {
    const m = computeNodeMetrics(draft, raw);
    expect(m.nodeVolumes["a0"]).toBe(142);
    expect(m.nodeVolumes["a1.b0.0"]).toBe(96);
    expect(m.nodeVolumes["a1.b1.0"]).toBe(36);
    expect(m.nodeVolumes["a1.else.0"]).toBe(10);
  });
  it("trigger y condition = total", () => {
    const m = computeNodeMetrics(draft, raw);
    expect(m.nodeVolumes["trigger"]).toBe(142);
    expect(m.nodeVolumes["condition"]).toBe(142);
  });
  it("decisión = suma de las entradas de sus ramas + else", () => {
    expect(computeNodeMetrics(draft, raw).nodeVolumes["a1"]).toBe(96 + 36 + 10);
  });
  it("% de reparto por rama (count + pct redondeado)", () => {
    const m = computeNodeMetrics(draft, raw);
    expect(m.branchSplits["a1.b0"]).toEqual({ count: 96, pct: 68 });
    expect(m.branchSplits["a1.b1"]).toEqual({ count: 36, pct: 25 });
  });
  it("rama sin pasos → {count:0, pct:0} y sin división por cero", () => {
    const d2 = ruleToDraft({
      id: "r2", name: "y", description: null, triggerType: "EVENT", triggerConfig: {}, conditions: {},
      cooldownMinutes: null, priority: 100, isActive: true,
      actions: [{ kind: "decision", branches: [{ conditions: {}, steps: [] }] }],
    } as never);
    const m = computeNodeMetrics(d2, { total: 0, counts: {} });
    expect(m.branchSplits["a0.b0"]).toEqual({ count: 0, pct: 0 });
    expect(m.nodeVolumes["a0"]).toBe(0);
  });
  it("decisión anidada: la entrada de la rama externa = volumen de la decisión interna", () => {
    const d3 = ruleToDraft({
      id: "r3", name: "z", description: null, triggerType: "EVENT", triggerConfig: {}, conditions: {},
      cooldownMinutes: null, priority: 100, isActive: true,
      actions: [{ kind: "decision", branches: [
        { conditions: {}, steps: [
          { kind: "decision", branches: [
            { conditions: {}, steps: [{ type: "ASSIGN", config: {} }] },
            { conditions: {}, steps: [{ type: "NOTIFY", config: {} }] },
          ] },
        ] },
      ] }],
    } as never);
    const m = computeNodeMetrics(d3, { total: 50, counts: { "0.b0.0.b0.0": 30, "0.b0.0.b1.0": 20 } });
    expect(m.nodeVolumes["a0.b0.0"]).toBe(50);
    expect(m.nodeVolumes["a0"]).toBe(50);
    expect(m.branchSplits["a0.b0"]).toEqual({ count: 50, pct: 100 });
  });
});
