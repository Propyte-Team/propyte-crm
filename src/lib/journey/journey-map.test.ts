import { describe, it, expect } from "vitest";
import { ruleStage, buildGeneralView, extractCampaigns, buildTargetedView, type RuleLite, type PlanLite } from "./journey-map";

const plan: PlanLite = { id: "pl1", name: "Bienvenida", isActive: true, steps: [{ actionType: "SEND_WHATSAPP", delayMinutes: 0 }] };

function rule(p: Partial<RuleLite>): RuleLite {
  return { id: "r", name: "R", isActive: true, triggerType: "EVENT", triggerConfig: {}, conditions: {}, actions: [], ...p };
}

describe("ruleStage", () => {
  it("LIFECYCLE_CHANGE → toStage", () => {
    expect(ruleStage(rule({ triggerType: "LIFECYCLE_CHANGE", triggerConfig: { toStage: "MQL" } }))).toBe("MQL");
  });
  it("acción SET_LIFECYCLE → toStage (última gana)", () => {
    expect(ruleStage(rule({ actions: [{ type: "SET_LIFECYCLE", config: { toStage: "SQL" } }] }))).toBe("SQL");
  });
  it("sin señal de etapa → GENERAL", () => {
    expect(ruleStage(rule({ actions: [{ type: "SEND_WHATSAPP", config: {} }] }))).toBe("GENERAL");
  });
  it("toStage inválido → GENERAL", () => {
    expect(ruleStage(rule({ triggerType: "LIFECYCLE_CHANGE", triggerConfig: { toStage: "NOPE" } }))).toBe("GENERAL");
  });
});

describe("buildGeneralView", () => {
  it("carriles en orden LIFECYCLE_ORDER + GENERAL al final, solo no vacíos", () => {
    const rMql = rule({ id: "rMql", triggerType: "LIFECYCLE_CHANGE", triggerConfig: { toStage: "MQL" },
      actions: [{ type: "ENROLL_PLAN", config: { planId: "pl1" } }] });
    const rGen = rule({ id: "rGen", actions: [{ type: "ADD_TAG", config: { tag: "x" } }] });
    const view = buildGeneralView([rMql, rGen], [plan]);
    const stages = view.lanes.map((l) => l.stage);
    expect(stages).toEqual(["MQL", "GENERAL"]);
    // la cadencia enrolada por rMql cae en MQL
    expect(view.lanes[0].cadences.map((c) => c.id)).toEqual(["pl1"]);
    expect(view.lanes[0].rules.map((r) => r.id)).toEqual(["rMql"]);
    expect(view.lanes[1].rules.map((r) => r.id)).toEqual(["rGen"]);
  });

  it("cadencia sin regla que la enrole → carril GENERAL", () => {
    const view = buildGeneralView([], [plan]);
    expect(view.lanes).toHaveLength(1);
    expect(view.lanes[0].stage).toBe("GENERAL");
    expect(view.lanes[0].cadences.map((c) => c.id)).toEqual(["pl1"]);
  });
});

describe("extractCampaigns", () => {
  it("junta valores distintos de adAttribution.campaignName en árbol anidado", () => {
    const rules = [
      rule({ conditions: { all: [{ field: "adAttribution.campaignName", op: "contains", value: "BROKERS" }] } }),
      rule({ conditions: { any: [
        { field: "adAttribution.campaignName", op: "contains", value: "EMPLEO" },
        { all: [{ field: "adAttribution.campaignName", op: "contains", value: "BROKERS" }] },
      ] } }),
    ];
    expect(extractCampaigns(rules).sort()).toEqual(["BROKERS", "EMPLEO"]);
  });
});

describe("buildTargetedView", () => {
  it("selecciona solo reglas cuyas condiciones referencian la campaña y arma el flujo", () => {
    const rBroker = rule({ id: "rB", name: "Brokers",
      triggerType: "EVENT", triggerConfig: { eventType: "lead.captured" },
      conditions: { all: [{ field: "adAttribution.campaignName", op: "contains", value: "BROKERS" }] },
      actions: [
        { type: "UPDATE_FIELD", config: { field: "contactType", value: "BROKER_EXTERNO" } },
        { type: "ENROLL_PLAN", config: { planId: "pl1" } },
        { type: "SET_LIFECYCLE", config: { toStage: "MQL" } },
      ] });
    const rOther = rule({ id: "rO", conditions: { all: [{ field: "contact.score", op: "gte", value: "70" }] } });
    const view = buildTargetedView([rBroker, rOther], [plan], { campaign: "BROKERS" });
    expect(view.flows).toHaveLength(1);
    const flow = view.flows[0];
    expect(flow[0].kind).toBe("trigger");
    expect(flow.some((n) => n.kind === "cadence" && n.label.includes("Bienvenida"))).toBe(true);
    expect(flow[flow.length - 1]).toMatchObject({ kind: "stage", label: "MQL" });
  });

  it("filtro por contactType selecciona reglas que lo referencian", () => {
    const r = rule({ id: "rE", conditions: { all: [{ field: "contact.contactType", op: "eq", value: "EMPLEO" }] } });
    const view = buildTargetedView([r], [], { contactType: "EMPLEO" });
    expect(view.flows).toHaveLength(1);
  });
});
