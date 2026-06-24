// Capa de derivación del mapa de journey (sub-C.1). Puro: sin React, sin BD.
import { LIFECYCLE_ORDER } from "@/lib/constants";

export interface ActionLite { type: string; config?: Record<string, unknown> }
export interface RuleLite {
  id: string; name: string; isActive: boolean;
  triggerType: string; triggerConfig: Record<string, unknown>;
  conditions: unknown; actions: ActionLite[];
}
export interface PlanLite {
  id: string; name: string; isActive: boolean;
  steps: { actionType: string; delayMinutes: number }[];
}

export type Lane = string; // LifecycleStage | "GENERAL"
export interface RuleNode { id: string; name: string; isActive: boolean; triggerType: string }
export interface CadenceNode { id: string; name: string; isActive: boolean; stepCount: number }
export interface GeneralView { lanes: { stage: Lane; rules: RuleNode[]; cadences: CadenceNode[] }[] }

const STAGES: string[] = LIFECYCLE_ORDER as unknown as string[];

/** Etapa de lifecycle a la que pertenece una regla, o "GENERAL" si no hay señal. */
export function ruleStage(rule: RuleLite): Lane {
  const t = rule.triggerConfig?.toStage;
  if (rule.triggerType === "LIFECYCLE_CHANGE" && typeof t === "string" && STAGES.includes(t)) return t;
  let fromAction: Lane = "GENERAL";
  for (const a of rule.actions ?? []) {
    if (a.type === "SET_LIFECYCLE") {
      const s = a.config?.toStage;
      if (typeof s === "string" && STAGES.includes(s)) fromAction = s; // última gana
    }
  }
  return fromAction;
}

function planIdsEnrolledBy(rule: RuleLite): string[] {
  return (rule.actions ?? [])
    .filter((a) => a.type === "ENROLL_PLAN" && typeof a.config?.planId === "string")
    .map((a) => a.config!.planId as string);
}

export function buildGeneralView(rules: RuleLite[], plans: PlanLite[]): GeneralView {
  const laneMap = new Map<Lane, { rules: RuleNode[]; cadences: CadenceNode[] }>();
  const ensure = (s: Lane) => { if (!laneMap.has(s)) laneMap.set(s, { rules: [], cadences: [] }); return laneMap.get(s)!; };

  const planById = new Map(plans.map((p) => [p.id, p]));
  const placedPlans = new Set<string>();

  for (const r of rules) {
    const stage = ruleStage(r);
    ensure(stage).rules.push({ id: r.id, name: r.name, isActive: r.isActive, triggerType: r.triggerType });
    for (const pid of planIdsEnrolledBy(r)) {
      const p = planById.get(pid);
      if (p && !placedPlans.has(pid)) {
        ensure(stage).cadences.push({ id: p.id, name: p.name, isActive: p.isActive, stepCount: p.steps.length });
        placedPlans.add(pid);
      }
    }
  }
  // Cadencias sin regla que las enrole → GENERAL
  for (const p of plans) {
    if (!placedPlans.has(p.id)) {
      ensure("GENERAL").cadences.push({ id: p.id, name: p.name, isActive: p.isActive, stepCount: p.steps.length });
    }
  }

  const order = [...STAGES, "GENERAL"];
  const lanes = order
    .filter((s) => laneMap.has(s))
    .map((s) => ({ stage: s, rules: laneMap.get(s)!.rules, cadences: laneMap.get(s)!.cadences }));
  return { lanes };
}

export interface FlowNode { kind: "trigger" | "condition" | "action" | "cadence" | "stage"; label: string }
export interface TargetedView { flows: FlowNode[][] }
export interface TargetedFilter { campaign?: string; contactType?: string }

// Recorre el árbol de condiciones (all/any/leaf) aplicando fn a cada hoja {field,op,value}.
function walkConditions(node: unknown, fn: (leaf: { field?: string; op?: string; value?: unknown }) => void): void {
  if (!node || typeof node !== "object") return;
  const n = node as Record<string, unknown>;
  if (Array.isArray(n.all)) { n.all.forEach((c) => walkConditions(c, fn)); return; }
  if (Array.isArray(n.any)) { n.any.forEach((c) => walkConditions(c, fn)); return; }
  if (typeof n.field === "string") fn(n as { field?: string; op?: string; value?: unknown });
}

export function extractCampaigns(rules: RuleLite[]): string[] {
  const set = new Set<string>();
  for (const r of rules) {
    walkConditions(r.conditions, (leaf) => {
      if (leaf.field === "adAttribution.campaignName" && typeof leaf.value === "string" && leaf.value) set.add(leaf.value);
    });
  }
  return [...set];
}

function ruleMatchesFilter(rule: RuleLite, filter: TargetedFilter): boolean {
  let match = false;
  walkConditions(rule.conditions, (leaf) => {
    if (filter.campaign && leaf.field === "adAttribution.campaignName" && String(leaf.value) === filter.campaign) match = true;
    if (filter.contactType && leaf.field === "contact.contactType" && String(leaf.value) === filter.contactType) match = true;
  });
  return match;
}

const ACTION_LABELS: Record<string, string> = {
  SEND_WHATSAPP: "💬 WhatsApp", SEND_EMAIL: "✉️ Email", CREATE_TASK: "📋 Tarea", NOTIFY: "🔔 Notificar",
  ASSIGN: "👤 Asignar", REASSIGN: "👤 Reasignar", ADD_TAG: "🏷️ Tag", UPDATE_FIELD: "✎ Campo",
  MAKE_CALL: "📞 Llamada", ESCALATE: "⚠️ Escalar", WEBHOOK: "🔗 Webhook",
};

export function buildTargetedView(rules: RuleLite[], plans: PlanLite[], filter: TargetedFilter): TargetedView {
  const planById = new Map(plans.map((p) => [p.id, p]));
  const flows: FlowNode[][] = [];

  for (const r of rules) {
    if (!ruleMatchesFilter(r, filter)) continue;
    const flow: FlowNode[] = [];
    const trigVal = (r.triggerConfig?.eventType ?? r.triggerConfig?.toStage ?? r.triggerType) as string;
    flow.push({ kind: "trigger", label: `⚡ ${r.name} (${trigVal})` });
    flow.push({ kind: "condition", label: filter.campaign ?? filter.contactType ?? "condición" });

    let stageEffect: string | null =
      r.triggerType === "LIFECYCLE_CHANGE" && typeof r.triggerConfig?.toStage === "string"
        ? (r.triggerConfig.toStage as string) : null;

    for (const a of r.actions ?? []) {
      if (a.type === "ENROLL_PLAN") {
        const p = planById.get(String(a.config?.planId));
        flow.push({ kind: "cadence", label: `⟳ ${p ? p.name : "cadencia"}${p ? ` (${p.steps.length} pasos)` : ""}` });
      } else if (a.type === "SET_LIFECYCLE") {
        if (typeof a.config?.toStage === "string") stageEffect = a.config.toStage as string;
      } else {
        flow.push({ kind: "action", label: ACTION_LABELS[a.type] ?? a.type });
      }
    }
    if (stageEffect) flow.push({ kind: "stage", label: stageEffect });
    flows.push(flow);
  }
  return { flows };
}
