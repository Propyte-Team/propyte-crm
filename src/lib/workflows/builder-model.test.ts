import { describe, it, expect } from "vitest";
import { buildTriggerConfig, parseValue, buildConditions, nodeToRows, parseTriggerValue, FIELD_SUGGESTIONS, LIFECYCLE_STAGES } from "./builder-model";
import { buildConditionsTree, parseConditions, type ConditionTree } from "./builder-model";
import { hasDecisionNode } from "./builder-model";

describe("parseValue", () => {
  it("exists → true", () => expect(parseValue("exists", "")).toBe(true));
  it("in → array recortado", () => expect(parseValue("in", "a, b ,c")).toEqual(["a", "b", "c"]));
  it("numérico → number", () => expect(parseValue("eq", "70")).toBe(70));
  it("texto → string", () => expect(parseValue("contains", "BROKER")).toBe("BROKER"));
});

describe("buildConditions (plano)", () => {
  it("vacío → {}", () => expect(buildConditions("all", [])).toEqual({}));
  it("filtra incompletas y serializa", () => {
    expect(buildConditions("any", [
      { field: "contact.score", op: "gte", value: "70" },
      { field: "", op: "eq", value: "x" },
    ])).toEqual({ any: [{ field: "contact.score", op: "gte", value: 70 }] });
  });
});

describe("nodeToRows", () => {
  it("reconstruye filas desde DSL", () => {
    expect(nodeToRows({ all: [{ field: "deal.stage", op: "eq", value: "WON" }] }))
      .toEqual({ combinator: "all", rows: [{ field: "deal.stage", op: "eq", value: "WON" }] });
  });
});

describe("buildTriggerConfig / parseTriggerValue", () => {
  it("EVENT round-trip", () => {
    const cfg = buildTriggerConfig("EVENT", "lead.captured");
    expect(cfg).toEqual({ eventType: "lead.captured" });
    expect(parseTriggerValue({ triggerConfig: cfg })).toBe("lead.captured");
  });
});

import { matchesTrigger } from "./engine";

describe("STAGE_CHANGE usa toStage (bug fix)", () => {
  it("buildTriggerConfig escribe toStage", () => {
    expect(buildTriggerConfig("STAGE_CHANGE", "RESERVED")).toEqual({ toStage: "RESERVED" });
  });

  it("parseTriggerValue lee toStage y compat con 'stage' viejo", () => {
    expect(parseTriggerValue({ triggerConfig: { toStage: "WON" } })).toBe("WON");
    expect(parseTriggerValue({ triggerConfig: { stage: "LOST" } })).toBe("LOST"); // regla vieja
  });

  it("round-trip: regla del builder matchea evento deal.stage_changed", () => {
    const cfg = buildTriggerConfig("STAGE_CHANGE", "RESERVED");
    const rule = { triggerType: "STAGE_CHANGE" as const, triggerConfig: cfg };
    const event = { type: "deal.stage_changed", payload: { toStage: "RESERVED" } };
    expect(matchesTrigger(rule, event as any)).toBe(true);
    const other = { type: "deal.stage_changed", payload: { toStage: "WON" } };
    expect(matchesTrigger(rule, other as any)).toBe(false);
  });
});

describe("condiciones anidadas (árbol 2 niveles)", () => {
  const tree: ConditionTree = {
    combinator: "any",
    items: [
      { field: "contact.score", op: "gte", value: "70" },
      { combinator: "all", conditions: [
        { field: "adAttribution.campaignName", op: "contains", value: "BROKER" },
        { field: "contact.leadSource", op: "eq", value: "REGISTRO_BROKER" },
      ] },
    ],
  };

  it("buildConditionsTree serializa al DSL anidado", () => {
    expect(buildConditionsTree(tree)).toEqual({
      any: [
        { field: "contact.score", op: "gte", value: 70 },
        { all: [
          { field: "adAttribution.campaignName", op: "contains", value: "BROKER" },
          { field: "contact.leadSource", op: "eq", value: "REGISTRO_BROKER" },
        ] },
      ],
    });
  });

  it("round-trip DSL→árbol→DSL es idempotente", () => {
    const dsl = buildConditionsTree(tree);
    expect(buildConditionsTree(parseConditions(dsl))).toEqual(dsl);
  });

  it("grupo sin hojas válidas se omite", () => {
    const t: ConditionTree = { combinator: "all", items: [{ combinator: "any", conditions: [{ field: "", op: "eq", value: "" }] }] };
    expect(buildConditionsTree(t)).toEqual({});
  });

  it("árbol vacío → {}", () => {
    expect(buildConditionsTree({ combinator: "all", items: [] })).toEqual({});
  });
});

describe("FIELD_SUGGESTIONS incluye campos de segmentación", () => {
  it("tiene contactType y adAttribution.*", () => {
    for (const f of ["contact.contactType", "adAttribution.campaignName", "adAttribution.adName", "adAttribution.adsetName", "adAttribution.network", "contact.custom."]) {
      expect(FIELD_SUGGESTIONS).toContain(f);
    }
  });
});

describe("LIFECYCLE_CHANGE trigger + LIFECYCLE_STAGES", () => {
  it("LIFECYCLE_CHANGE escribe toStage", () => {
    expect(buildTriggerConfig("LIFECYCLE_CHANGE", "MQL")).toEqual({ toStage: "MQL" });
  });
  it("parseTriggerValue lee toStage de LIFECYCLE_CHANGE", () => {
    expect(parseTriggerValue({ triggerType: "LIFECYCLE_CHANGE", triggerConfig: { toStage: "MQL" } })).toBe("MQL");
  });
  it("contact.lifecycleStage está en FIELD_SUGGESTIONS", () => {
    expect(FIELD_SUGGESTIONS).toContain("contact.lifecycleStage");
  });
  it("LIFECYCLE_STAGES expone las 7 etapas", () => {
    expect(LIFECYCLE_STAGES).toHaveLength(7);
  });
});

describe("hasDecisionNode (guard anti data-loss del form plano — sub-task 3)", () => {
  it("detecta un nodo kind:'decision' en el nivel superior de actions", () => {
    const actions = [
      { kind: "decision", branches: [{ conditions: {}, steps: [{ type: "ASSIGN", config: {} }] }] },
    ];
    expect(hasDecisionNode(actions)).toBe(true);
  });
  it("no marca falso positivo para una lista plana de ActionSpec simples", () => {
    const actions = [{ type: "ADD_TAG", config: { tag: "x" } }, { type: "ASSIGN", config: {} }];
    expect(hasDecisionNode(actions)).toBe(false);
  });
  it("es false para actions ausente, vacío o no-array", () => {
    expect(hasDecisionNode(undefined)).toBe(false);
    expect(hasDecisionNode([])).toBe(false);
    expect(hasDecisionNode(null)).toBe(false);
    expect(hasDecisionNode("not-an-array")).toBe(false);
  });
  it("detecta la decisión aunque venga mezclada con acciones planas antes/después", () => {
    const actions = [
      { type: "NOTIFY", config: {} },
      { kind: "decision", branches: [{ conditions: {}, steps: [] }] },
      { type: "ADD_TAG", config: { tag: "y" } },
    ];
    expect(hasDecisionNode(actions)).toBe(true);
  });
});
