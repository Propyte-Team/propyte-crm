import { describe, it, expect } from "vitest";
import { ruleToDraft, draftToRulePayload, draftToFlow, type RuleRow } from "./rule-draft";

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
  it("añade nodeId estable a cada acción", () => {
    const d = ruleToDraft(ROW);
    expect(d.actions.map((a) => a.nodeId)).toEqual(["a0", "a1", "a2"]);
    expect(d.id).toBe("r1");
  });

  it("round-trip: draftToRulePayload(ruleToDraft(row)) reproduce el payload canónico", () => {
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
  it("cadena trigger→condition→acciones con IDs estables", () => {
    const flow = draftToFlow(ruleToDraft(ROW));
    expect(flow.nodes.map((n) => n.id)).toEqual(["trigger", "condition", "a0", "a1", "a2"]);
    expect(flow.nodes.map((n) => n.type)).toEqual(["trigger", "condition", "action", "action", "stage"]);
    expect(flow.edges.map((e) => [e.source, e.target])).toEqual([
      ["trigger", "condition"], ["condition", "a0"], ["a0", "a1"], ["a1", "a2"],
    ]);
  });

  it("omite el nodo condición cuando conditions está vacío ({})", () => {
    const d = ruleToDraft({ ...ROW, conditions: {} as never });
    const flow = draftToFlow(d);
    expect(flow.nodes.map((n) => n.id)).toEqual(["trigger", "a0", "a1", "a2"]);
    expect(flow.edges[0]).toMatchObject({ source: "trigger", target: "a0" });
  });

  it("el data de cada acción lleva type y config reales", () => {
    const flow = draftToFlow(ruleToDraft(ROW));
    const a0 = flow.nodes.find((n) => n.id === "a0")!;
    expect(a0.data).toMatchObject({ actionType: "SEND_WHATSAPP", config: { template: "bienvenida" } });
  });
});
