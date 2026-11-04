import { describe, it, expect } from "vitest";
import { generalToFlow, targetedToFlow, applyPositions, type RFNode } from "./flow-adapter";
import type { GeneralView, TargetedView } from "./journey-map";

const general: GeneralView = { lanes: [
  { stage: "LEAD", rules: [{ id: "r1", name: "Speed", isActive: true, triggerType: "EVENT", isSlaBreach: false }],
    cadences: [{ id: "p1", name: "Bienvenida", isActive: true, stepCount: 3 }] },
  { stage: "MQL", rules: [{ id: "r2", name: "Respondió", isActive: false, triggerType: "EVENT", isSlaBreach: false }], cadences: [] },
] };

describe("generalToFlow", () => {
  it("genera nodos con IDs estables (stage/rule/plan) + aristas de avance entre etapas", () => {
    const { nodes, edges } = generalToFlow(general);
    const ids = nodes.map((n) => n.id);
    expect(ids).toContain("stage:LEAD");
    expect(ids).toContain("rule:r1");
    expect(ids).toContain("plan:p1");
    expect(ids).toContain("stage:MQL");
    // arista de avance entre cabeceras de etapa consecutivas
    expect(edges.some((e) => e.source === "stage:LEAD" && e.target === "stage:MQL")).toBe(true);
    // todos los nodos tienen posición por auto-layout
    expect(nodes.every((n) => typeof n.position.x === "number" && typeof n.position.y === "number")).toBe(true);
  });
});

describe("targetedToFlow", () => {
  it("encadena nodos del flujo con aristas secuenciales", () => {
    const tv: TargetedView = { flows: [[
      { kind: "trigger", label: "⚡ Brokers" },
      { kind: "action", label: "👤 Asignar" },
      { kind: "stage", label: "MQL" },
    ]] };
    const { nodes, edges } = targetedToFlow(tv);
    expect(nodes).toHaveLength(3);
    expect(edges).toHaveLength(2);
    expect(edges[0].source).toBe(nodes[0].id);
    expect(edges[0].target).toBe(nodes[1].id);
  });

  it("propaga planId a data del nodo cadence (deep-link a config)", () => {
    const tv: TargetedView = { flows: [[
      { kind: "trigger", label: "⚡ Brokers" },
      { kind: "cadence", label: "⟳ Bienvenida", planId: "pl1" },
    ]] };
    const { nodes } = targetedToFlow(tv);
    const cadence = nodes.find((n) => n.type === "cadence")!;
    expect(cadence.data.planId).toBe("pl1");
  });

  it("propaga isSlaBreach a data del nodo trigger (badge en canvas)", () => {
    const tv: TargetedView = { flows: [[
      { kind: "trigger", label: "⚡ SLA vencido", isSlaBreach: true },
    ]] };
    const { nodes } = targetedToFlow(tv);
    expect(nodes[0].data.isSlaBreach).toBe(true);
  });

  it("no agrega planId/isSlaBreach a data cuando no vienen en el FlowNode", () => {
    const tv: TargetedView = { flows: [[{ kind: "action", label: "👤 Asignar" }]] };
    const { nodes } = targetedToFlow(tv);
    expect(nodes[0].data.planId).toBeUndefined();
    expect(nodes[0].data.isSlaBreach).toBeUndefined();
  });
});

describe("generalToFlow — planId e isSlaBreach en data", () => {
  it("nodo cadence lleva planId (== id del plan)", () => {
    const { nodes } = generalToFlow(general);
    const cadence = nodes.find((n) => n.id === "plan:p1")!;
    expect(cadence.data.planId).toBe("p1");
  });
  it("nodo rule lleva isSlaBreach", () => {
    const view: GeneralView = { lanes: [
      { stage: "LEAD", rules: [{ id: "rSla", name: "SLA", isActive: true, triggerType: "SLA_BREACH", isSlaBreach: true }], cadences: [] },
    ] };
    const { nodes } = generalToFlow(view);
    expect(nodes.find((n) => n.id === "rule:rSla")!.data.isSlaBreach).toBe(true);
  });
});

describe("IDs estables y aristas (E4 #3, #11)", () => {
  it("targetedToFlow usa rule.id en el ID del nodo, no el índice", () => {
    const tv: TargetedView = { flows: [[{ kind: "trigger", label: "t" }, { kind: "action", label: "a" }]], ruleIds: ["abc"] };
    const { nodes } = targetedToFlow(tv);
    expect(nodes.map((n) => n.id)).toEqual(["f:abc:trigger:0", "f:abc:action:1"]);
    // al anteponer otra regla, los IDs de "abc" no cambian
    const tv2: TargetedView = { flows: [[{ kind: "trigger", label: "x" }], tv.flows[0]], ruleIds: ["zzz", "abc"] };
    expect(targetedToFlow(tv2).nodes.map((n) => n.id)).toContain("f:abc:trigger:0");
  });
  it("generalToFlow dibuja regla → cadencia y regla → etapa destino", () => {
    const view: GeneralView = { lanes: [
      { stage: "ENTRADA", rules: [{ id: "r1", name: "Entrada", isActive: true, triggerType: "EVENT", isSlaBreach: false, planIds: ["p1"], stageTargets: ["MQL"] }],
        cadences: [{ id: "p1", name: "Bienvenida", isActive: true, stepCount: 2 }] },
      { stage: "MQL", rules: [], cadences: [] },
    ] };
    const { edges, nodes } = generalToFlow(view);
    expect(nodes.find((n) => n.id === "stage:ENTRADA")!.data.label).toBe("Entrada de leads");
    expect(edges.some((e) => e.source === "rule:r1" && e.target === "plan:p1")).toBe(true);
    expect(edges.some((e) => e.source === "rule:r1" && e.target === "stage:MQL")).toBe(true);
  });
});

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
