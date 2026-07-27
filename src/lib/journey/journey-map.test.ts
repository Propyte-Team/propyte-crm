import { describe, it, expect } from "vitest";
import {
  ruleStage, buildGeneralView, extractCampaigns, buildTargetedView,
  deriveSlaPanel, isSlaTriggeredRule, summarizeConditions, resolveRuleJourneyLink,
  type RuleLite, type PlanLite, type SlaPolicyLite,
} from "./journey-map";

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

describe("nodos de decisión (árbol de acciones)", () => {
  // Un decision node tiene kind:"decision" y no tiene type, por eso el acceso plano
  // falla silenciosamente o crashea si el código asume ActionLite[] plano.
  const decisionRule = rule({
    id: "rDecision",
    actions: [
      {
        kind: "decision",
        branches: [
          {
            conditions: {},
            steps: [
              { type: "SET_LIFECYCLE", config: { toStage: "MQL" } },
              { type: "ENROLL_PLAN", config: { planId: "pl1" } },
            ],
          },
        ],
        else: [{ type: "SEND_WHATSAPP", config: {} }],
      } as unknown as import("./journey-map").ActionLite,
    ],
  });

  it("ruleStage no se rompe con decision node y ve SET_LIFECYCLE dentro de la rama", () => {
    expect(() => ruleStage(decisionRule)).not.toThrow();
    // La acción SET_LIFECYCLE está dentro de una rama — debe verse igual que si fuera top-level
    expect(ruleStage(decisionRule)).toBe("MQL");
  });

  it("buildGeneralView no se rompe y coloca la regla en MQL (via SET_LIFECYCLE en rama)", () => {
    let view!: ReturnType<typeof buildGeneralView>;
    expect(() => { view = buildGeneralView([decisionRule], [plan]); }).not.toThrow();
    const stages = view.lanes.map((l) => l.stage);
    expect(stages).toContain("MQL");
    const mqlLane = view.lanes.find((l) => l.stage === "MQL")!;
    expect(mqlLane.rules.map((r) => r.id)).toContain("rDecision");
    // ENROLL_PLAN dentro de la rama también debe enrolar la cadencia
    expect(mqlLane.cadences.map((c) => c.id)).toContain("pl1");
  });

  it("buildTargetedView no se rompe y renderiza ENROLL_PLAN y SET_LIFECYCLE de la rama", () => {
    const rWithFilter = rule({
      id: "rDF",
      conditions: { all: [{ field: "adAttribution.campaignName", op: "contains", value: "TEST" }] },
      actions: [
        {
          kind: "decision",
          branches: [
            {
              conditions: {},
              steps: [
                { type: "ENROLL_PLAN", config: { planId: "pl1" } },
                { type: "SET_LIFECYCLE", config: { toStage: "SQL" } },
              ],
            },
          ],
        } as unknown as import("./journey-map").ActionLite,
      ],
    });
    let view!: ReturnType<typeof buildTargetedView>;
    expect(() => { view = buildTargetedView([rWithFilter], [plan], { campaign: "TEST" }); }).not.toThrow();
    expect(view.flows).toHaveLength(1);
    const flow = view.flows[0];
    expect(flow.some((n) => n.kind === "cadence")).toBe(true);
    expect(flow[flow.length - 1]).toMatchObject({ kind: "stage", label: "SQL" });
  });
});

describe("isSlaTriggeredRule", () => {
  it("true cuando triggerType es SLA_BREACH", () => {
    expect(isSlaTriggeredRule(rule({ triggerType: "SLA_BREACH" }))).toBe(true);
  });
  it("false para cualquier otro triggerType", () => {
    expect(isSlaTriggeredRule(rule({ triggerType: "EVENT" }))).toBe(false);
  });
});

describe("summarizeConditions", () => {
  it("sin condiciones (objeto vacío) → texto 'aplica siempre'", () => {
    expect(summarizeConditions({})).toBe("Sin condiciones (aplica siempre)");
  });
  it("una condición simple → 'campo op valor'", () => {
    expect(summarizeConditions({ all: [{ field: "contact.score", op: "gte", value: 70 }] })).toBe("contact.score ≥ 70");
  });
  it("múltiples condiciones anidadas (any + subgrupo) → unidas con separador", () => {
    const s = summarizeConditions({
      any: [
        { field: "adAttribution.campaignName", op: "contains", value: "BROKERS" },
        { all: [{ field: "contact.contactType", op: "eq", value: "EMPLEO" }] },
      ],
    });
    expect(s).toContain("adAttribution.campaignName contiene BROKERS");
    expect(s).toContain("contact.contactType = EMPLEO");
  });
  it("op exists no imprime el valor booleano", () => {
    expect(summarizeConditions({ all: [{ field: "contact.custom.x", op: "exists", value: true }] })).toBe("contact.custom.x existe");
  });
});

describe("deriveSlaPanel", () => {
  const base: SlaPolicyLite = {
    id: "s1", name: "Default", isActive: true, isDefault: true, priority: 100,
    firstTouchMinutes: 15, retryMinutes: 60, orphanHours: 24, conditions: {},
  };
  it("filtra solo políticas activas", () => {
    const inactive: SlaPolicyLite = { ...base, id: "s2", isActive: false, isDefault: false };
    const rows = deriveSlaPanel([base, inactive]);
    expect(rows.map((r) => r.id)).toEqual(["s1"]);
  });
  it("ordena por prioridad ascendente", () => {
    const low: SlaPolicyLite = { ...base, id: "sLow", isDefault: false, priority: 10, conditions: { all: [{ field: "contact.score", op: "gte", value: 80 }] } };
    const rows = deriveSlaPanel([base, low]);
    expect(rows.map((r) => r.id)).toEqual(["sLow", "s1"]);
  });
  it("marca isDefault y resume 'Todos los contactos' para la política default", () => {
    const rows = deriveSlaPanel([base]);
    expect(rows[0]).toMatchObject({ isDefault: true, conditionsSummary: "Todos los contactos (default)" });
  });
  it("expone los umbrales de tiempo tal cual (min/min/horas)", () => {
    const rows = deriveSlaPanel([base]);
    expect(rows[0]).toMatchObject({ firstTouchMinutes: 15, retryMinutes: 60, orphanHours: 24 });
  });
  it("política no-default resume su segmento de condiciones", () => {
    const vip: SlaPolicyLite = { ...base, id: "sVip", isDefault: false, priority: 5, conditions: { all: [{ field: "contact.score", op: "gte", value: 90 }] } };
    const rows = deriveSlaPanel([vip]);
    expect(rows[0].conditionsSummary).toBe("contact.score ≥ 90");
  });
});

describe("resolveRuleJourneyLink", () => {
  it("regla sin match → { mode: 'general' } (degradación)", () => {
    expect(resolveRuleJourneyLink(undefined)).toEqual({ mode: "general" });
  });
  it("regla sin condición de campaña → degrada a general", () => {
    const r = rule({ conditions: { all: [{ field: "contact.score", op: "gte", value: "70" }] } });
    expect(resolveRuleJourneyLink(r)).toEqual({ mode: "general" });
  });
  it("regla con condición de campaña → targeted + esa campaña", () => {
    const r = rule({ conditions: { all: [{ field: "adAttribution.campaignName", op: "contains", value: "BROKERS" }] } });
    expect(resolveRuleJourneyLink(r)).toEqual({ mode: "targeted", campaign: "BROKERS" });
  });
});

describe("buildTargetedView — planId e isSlaBreach en nodos", () => {
  it("nodo cadence lleva planId del plan enrolado", () => {
    const r = rule({
      id: "rB", conditions: { all: [{ field: "adAttribution.campaignName", op: "contains", value: "BROKERS" }] },
      actions: [{ type: "ENROLL_PLAN", config: { planId: "pl1" } }],
    });
    const view = buildTargetedView([r], [plan], { campaign: "BROKERS" });
    const cadenceNode = view.flows[0].find((n) => n.kind === "cadence");
    expect(cadenceNode?.planId).toBe("pl1");
  });
  it("nodo trigger lleva isSlaBreach cuando la regla dispara por SLA_BREACH", () => {
    const r = rule({
      id: "rSla", triggerType: "SLA_BREACH",
      conditions: { all: [{ field: "adAttribution.campaignName", op: "contains", value: "BROKERS" }] },
    });
    const view = buildTargetedView([r], [], { campaign: "BROKERS" });
    const triggerNode = view.flows[0].find((n) => n.kind === "trigger");
    expect(triggerNode?.isSlaBreach).toBe(true);
  });
});

describe("buildGeneralView — isSlaBreach en RuleNode", () => {
  it("marca isSlaBreach:true en reglas SLA_BREACH, false en las demás", () => {
    const rSla = rule({ id: "rSla", triggerType: "SLA_BREACH" });
    const rNormal = rule({ id: "rNorm", triggerType: "EVENT" });
    const view = buildGeneralView([rSla, rNormal], []);
    const gen = view.lanes.find((l) => l.stage === "GENERAL")!;
    expect(gen.rules.find((r) => r.id === "rSla")?.isSlaBreach).toBe(true);
    expect(gen.rules.find((r) => r.id === "rNorm")?.isSlaBreach).toBe(false);
  });
});

describe("robustez ante datos corruptos", () => {
  // Regla con actions no-array y conditions null (dato corrupto) no debe lanzar.
  const corrupt = rule({ id: "rCorrupt", actions: {} as unknown as RuleLite["actions"], conditions: null });

  it("ruleStage degrada a GENERAL", () => {
    expect(() => ruleStage(corrupt)).not.toThrow();
    expect(ruleStage(corrupt)).toBe("GENERAL");
  });
  it("buildGeneralView no lanza y deja la regla en GENERAL", () => {
    let view!: ReturnType<typeof buildGeneralView>;
    expect(() => { view = buildGeneralView([corrupt], []); }).not.toThrow();
    expect(view.lanes.map((l) => l.stage)).toEqual(["GENERAL"]);
  });
  it("buildTargetedView no lanza y no produce flujos", () => {
    let view!: ReturnType<typeof buildTargetedView>;
    expect(() => { view = buildTargetedView([corrupt], [], { campaign: "BROKERS" }); }).not.toThrow();
    expect(view.flows).toHaveLength(0);
  });
  it("extractCampaigns no lanza con conditions null", () => {
    expect(() => extractCampaigns([corrupt])).not.toThrow();
    expect(extractCampaigns([corrupt])).toEqual([]);
  });
});
