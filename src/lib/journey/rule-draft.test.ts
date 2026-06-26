import { describe, it, expect } from "vitest";
import { ruleToDraft, draftToRulePayload, draftToFlow, newRuleDraft, type RuleRow, addAction, removeAction, removeNode, addDecision, addBranch, removeBranch, setBranchConditions, setBranchLabel, reorderAction, setActionConfig, setActionType, setActionDelay, setTrigger, setConditions, setMeta, insertAction } from "./rule-draft";

const ROW: RuleRow = {
  id: "r1",
  name: "Speed to lead Meta",
  description: "Bienvenida inmediata",
  triggerType: "EVENT",
  triggerConfig: { eventType: "lead.captured" },
  conditions: { all: [{ field: "adAttribution.platform", op: "eq", value: "META" }] },
  actions: [
    { type: "SEND_WHATSAPP", config: { template: "bienvenida" }, delayMinutes: 0 },
    { type: "ASSIGN", config: { mode: "ROUND_ROBIN" } },
    { type: "CHANGE_STAGE", config: { toStage: "MQL" } },
  ],
  cooldownMinutes: 60,
  priority: 100,
  isActive: true,
};

describe("ruleToDraft / draftToRulePayload", () => {
  it("aÃ±ade nodeId estable a cada acciÃ³n", () => {
    const d = ruleToDraft(ROW);
    expect(d.actions.map((a) => a.nodeId)).toEqual(["a0", "a1", "a2"]);
    expect(d.id).toBe("r1");
  });

  it("round-trip: draftToRulePayload(ruleToDraft(row)) reproduce el payload canÃ³nico", () => {
    const payload = draftToRulePayload(ruleToDraft(ROW));
    expect(payload).toEqual({
      id: "r1",
      name: "Speed to lead Meta",
      description: "Bienvenida inmediata",
      triggerType: "EVENT",
      triggerConfig: { eventType: "lead.captured" },
      conditions: { all: [{ field: "adAttribution.platform", op: "eq", value: "META" }] },
      actions: [
        { type: "SEND_WHATSAPP", config: { template: "bienvenida" }, delayMinutes: 0 },
        { type: "ASSIGN", config: { mode: "ROUND_ROBIN" } },
        { type: "CHANGE_STAGE", config: { toStage: "MQL" } },
      ],
      cooldownMinutes: 60,
      priority: 100,
      isActive: true,
    });
  });

  it("regla nueva (sin id) no incluye id en el payload", () => {
    const payload = draftToRulePayload({ ...ruleToDraft(ROW), id: undefined });
    expect("id" in payload).toBe(false);
  });
});

describe("draftToFlow", () => {
  it("cadena triggerâ†’conditionâ†’acciones con IDs estables", () => {
    const flow = draftToFlow(ruleToDraft(ROW));
    expect(flow.nodes.map((n) => n.id)).toEqual(["trigger", "condition", "a0", "a1", "a2"]);
    expect(flow.nodes.map((n) => n.type)).toEqual(["trigger", "condition", "action", "action", "stage"]);
    expect(flow.edges.map((e) => [e.source, e.target])).toEqual([
      ["trigger", "condition"], ["condition", "a0"], ["a0", "a1"], ["a1", "a2"],
    ]);
  });

  it("omite el nodo condiciÃ³n cuando conditions estÃ¡ vacÃ­o ({})", () => {
    const d = ruleToDraft({ ...ROW, conditions: {} as never });
    const flow = draftToFlow(d);
    expect(flow.nodes.map((n) => n.id)).toEqual(["trigger", "a0", "a1", "a2"]);
    expect(flow.edges[0]).toMatchObject({ source: "trigger", target: "a0" });
  });

  it("el data de cada acciÃ³n lleva type y config reales", () => {
    const flow = draftToFlow(ruleToDraft(ROW));
    const a0 = flow.nodes.find((n) => n.id === "a0")!;
    expect(a0.data).toMatchObject({ actionType: "SEND_WHATSAPP", config: { template: "bienvenida" } });
  });
});

describe("ops puras", () => {
  const base = ruleToDraft(ROW);

  it("addAction inserta al final con nodeId reindexado y config vacÃ­o", () => {
    const d = addAction(base, "NOTIFY");
    expect(d.actions.length).toBe(4);
    expect(d.actions[3]).toMatchObject({ nodeId: "a3", type: "NOTIFY", config: {} });
    expect(base.actions.length).toBe(3); // inmutable
  });

  it("removeAction quita y reindexa nodeIds", () => {
    const d = removeAction(base, "a1");
    expect(d.actions.map((a) => a.type)).toEqual(["SEND_WHATSAPP", "CHANGE_STAGE"]);
    expect(d.actions.map((a) => a.nodeId)).toEqual(["a0", "a1"]);
  });

  it("reorderAction up mueve y reindexa", () => {
    const d = reorderAction(base, "a1", "up");
    expect(d.actions.map((a) => a.type)).toEqual(["ASSIGN", "SEND_WHATSAPP", "CHANGE_STAGE"]);
    expect(d.actions.map((a) => a.nodeId)).toEqual(["a0", "a1", "a2"]);
  });

  it("reorderAction en el borde es no-op", () => {
    expect(reorderAction(base, "a0", "up").actions.map((a) => a.type)).toEqual(base.actions.map((a) => a.type));
  });

  it("setActionConfig hace merge superficial del config", () => {
    const d = setActionConfig(base, "a0", { template: "promo" });
    expect(d.actions[0].config).toEqual({ template: "promo" });
  });

  it("setActionType cambia el tipo y limpia el config (evita config huÃ©rfano)", () => {
    const d = setActionType(base, "a0", "MAKE_CALL");
    expect(d.actions[0]).toMatchObject({ nodeId: "a0", type: "MAKE_CALL", config: {} });
  });

  it("setActionDelay fija delayMinutes en la acciÃ³n (no en config)", () => {
    const d = setActionDelay(base, "a0", 15);
    expect(d.actions[0].delayMinutes).toBe(15);
    expect(d.actions[0].config).toEqual({ template: "bienvenida" });
  });

  it("setTrigger reemplaza tipo y config", () => {
    const d = setTrigger(base, { triggerType: "STAGE_CHANGE", triggerConfig: { toStage: "SQL" } });
    expect(d.triggerType).toBe("STAGE_CHANGE");
    expect(d.triggerConfig).toEqual({ toStage: "SQL" });
  });

  it("setConditions reemplaza el Ã¡rbol", () => {
    const c = { any: [{ field: "x", op: "eq", value: 1 }] };
    expect(setConditions(base, c as never).conditions).toEqual(c);
  });

  it("setMeta hace merge de campos de regla", () => {
    const d = setMeta(base, { isActive: false, priority: 50 });
    expect(d.isActive).toBe(false);
    expect(d.priority).toBe(50);
    expect(d.name).toBe(base.name);
  });
});

describe("save payload selection", () => {
  it("regla existente â†’ payload incluye id; nueva â†’ sin id", () => {
    expect("id" in draftToRulePayload(ruleToDraft(ROW))).toBe(true);
    expect("id" in draftToRulePayload(newRuleDraft())).toBe(false);
  });
});

describe("insertAction", () => {
  const base = ruleToDraft(ROW); // 3 acciones: SEND_WHATSAPP, ASSIGN, CHANGE_STAGE

  it("inserta en el medio y reindexa nodeIds", () => {
    const d = insertAction(base, "NOTIFY", 1);
    expect(d.actions.map((a) => a.type)).toEqual(["SEND_WHATSAPP", "NOTIFY", "ASSIGN", "CHANGE_STAGE"]);
    expect(d.actions.map((a) => a.nodeId)).toEqual(["a0", "a1", "a2", "a3"]);
    expect(d.actions[1].config).toEqual({});
    expect(base.actions.length).toBe(3); // inmutable
  });

  it("atIndex=0 inserta al inicio; atIndex>=length inserta al final (clamp)", () => {
    expect(insertAction(base, "ADD_TAG", 0).actions[0].type).toBe("ADD_TAG");
    expect(insertAction(base, "ADD_TAG", 99).actions.at(-1)!.type).toBe("ADD_TAG");
  });
});

const rowConDecision = {
  id: "r1", name: "Ramas", description: null, triggerType: "EVENT", triggerConfig: {},
  conditions: {}, cooldownMinutes: null, priority: 100, isActive: false,
  actions: [
    { type: "ADD_TAG", config: { tag: "nuevo" } },
    { kind: "decision", label: "Por origen", branches: [
      { label: "META", conditions: { field: "adAttribution.network", op: "eq", value: "meta" }, steps: [{ type: "ASSIGN", config: {} }] },
    ], else: [{ type: "NOTIFY", config: {} }] },
  ],
};

describe("rule-draft Ã¡rbol round-trip", () => {
  it("ruleToDraft â†’ draftToRulePayload preserva el Ã¡rbol (sin nodeId/branchId)", () => {
    const draft = ruleToDraft(rowConDecision as never);
    const payload = draftToRulePayload(draft);
    expect(payload.actions).toEqual(rowConDecision.actions);
  });

  it("asigna nodeId estables al nivel raÃ­z (a0, a1)", () => {
    const draft = ruleToDraft(rowConDecision as never);
    expect(draft.actions[0].nodeId).toBe("a0");
    expect(draft.actions[1].nodeId).toBe("a1");
  });
});

describe("rule-draft ops de árbol", () => {
  it("addAction agrega al nivel raíz", () => {
    const d = addAction(newRuleDraft(), "ADD_TAG");
    expect(d.actions.at(-1)).toMatchObject({ type: "ADD_TAG" });
  });

  it("addAction NO tira nodos de decisión existentes", () => {
    let d = addDecision(newRuleDraft());      // raíz: [a0 acción, a1 decisión]
    const before = d.actions.filter((n) => n.kind === "decision").length;
    d = addAction(d, "NOTIFY");
    const after = d.actions.filter((n) => n.kind === "decision").length;
    expect(after).toBe(before);               // la decisión sobrevive
    expect(before).toBe(1);
  });

  it("addDecision agrega un nodo decisión con una rama vacía", () => {
    const d = addDecision(newRuleDraft());
    const dec = d.actions.at(-1) as { kind: string; branches: unknown[] };
    expect(dec.kind).toBe("decision");
    expect(dec.branches).toHaveLength(1);
  });

  it("addBranch agrega rama a una decisión por nodeId", () => {
    let d = addDecision(newRuleDraft());
    const decId = (d.actions.at(-1) as { nodeId: string }).nodeId;
    d = addBranch(d, decId);
    expect((d.actions.at(-1) as { branches: unknown[] }).branches).toHaveLength(2);
  });

  it("setBranchConditions / setBranchLabel mutan la rama correcta", () => {
    let d = addDecision(newRuleDraft());
    const dec = d.actions.at(-1) as { branches: { branchId: string }[] };
    const bid = dec.branches[0].branchId;
    d = setBranchLabel(d, bid, "META");
    d = setBranchConditions(d, bid, { field: "adAttribution.network", op: "eq", value: "meta" } as never);
    const b = (d.actions.at(-1) as { branches: { branchId: string; label?: string; conditions: unknown }[] }).branches[0];
    expect(b.label).toBe("META");
    expect(b.conditions).toMatchObject({ field: "adAttribution.network" });
  });

  it("removeNode elimina un nodo en cualquier nivel y reindexa raíz", () => {
    let d = addAction(newRuleDraft(), "NOTIFY"); // a0 (CHANGE_STAGE), a1 (NOTIFY)
    d = removeNode(d, "a0");
    expect(d.actions).toHaveLength(1);
    expect(d.actions[0].nodeId).toBe("a0"); // reindexado
  });

  it("removeBranch quita una rama; si queda 0, deja la decisión con 1 rama vacía", () => {
    let d = addDecision(newRuleDraft());
    let dec = d.actions.at(-1) as { nodeId: string; branches: { branchId: string }[] };
    d = addBranch(d, dec.nodeId);
    dec = d.actions.at(-1) as { nodeId: string; branches: { branchId: string }[] };
    d = removeBranch(d, dec.branches[0].branchId);
    expect((d.actions.at(-1) as { branches: unknown[] }).branches).toHaveLength(1);
  });
});
