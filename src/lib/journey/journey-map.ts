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
export interface RuleNode { id: string; name: string; isActive: boolean; triggerType: string; isSlaBreach: boolean }
export interface CadenceNode { id: string; name: string; isActive: boolean; stepCount: number }
export interface GeneralView { lanes: { stage: Lane; rules: RuleNode[]; cadences: CadenceNode[] }[] }

export interface SlaPolicyLite {
  id: string; name: string; isActive: boolean; isDefault: boolean; priority: number;
  firstTouchMinutes: number; retryMinutes: number; orphanHours: number; conditions: unknown;
}
export interface SlaPanelRow {
  id: string; name: string; isDefault: boolean; priority: number;
  firstTouchMinutes: number; retryMinutes: number; orphanHours: number; conditionsSummary: string;
}

const STAGES: string[] = LIFECYCLE_ORDER as unknown as string[];

/** Devuelve rule.actions solo si es array; degrada a [] ante dato corrupto (objeto/null). */
function safeActions(rule: RuleLite): ActionLite[] {
  return Array.isArray(rule.actions) ? rule.actions : [];
}

/**
 * Recorre el árbol de acciones (nodos planos + decision nodes anidados) y devuelve
 * una lista plana de todos los ActionLite con `type` definido.
 * Un decision node tiene `kind:"decision"` y no tiene `type`; sus ramas están en
 * `branches[].steps` y en `else` (ambos arrays recursivos).
 */
function collectActionNodes(nodes: unknown): ActionLite[] {
  if (!Array.isArray(nodes)) return [];
  const out: ActionLite[] = [];
  for (const n of nodes) {
    if (n && typeof n === "object" && (n as { kind?: string }).kind === "decision") {
      const d = n as { branches?: { steps?: unknown }[]; else?: unknown };
      for (const b of d.branches ?? []) out.push(...collectActionNodes(b.steps));
      out.push(...collectActionNodes(d.else));
    } else if (n && typeof n === "object" && typeof (n as { type?: string }).type === "string") {
      out.push(n as ActionLite);
    }
  }
  return out;
}

/** Etapa de lifecycle a la que pertenece una regla, o "GENERAL" si no hay señal. */
export function ruleStage(rule: RuleLite): Lane {
  const t = rule.triggerConfig?.toStage;
  if (rule.triggerType === "LIFECYCLE_CHANGE" && typeof t === "string" && STAGES.includes(t)) return t;
  let fromAction: Lane = "GENERAL";
  for (const a of collectActionNodes(safeActions(rule))) {
    if (a.type === "SET_LIFECYCLE") {
      const s = a.config?.toStage;
      if (typeof s === "string" && STAGES.includes(s)) fromAction = s; // última gana
    }
  }
  return fromAction;
}

/** true si la regla se dispara por incumplimiento de SLA (badge en el canvas de Journey). */
export function isSlaTriggeredRule(rule: RuleLite): boolean {
  return rule.triggerType === "SLA_BREACH";
}

function planIdsEnrolledBy(rule: RuleLite): string[] {
  return collectActionNodes(safeActions(rule))
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
    ensure(stage).rules.push({ id: r.id, name: r.name, isActive: r.isActive, triggerType: r.triggerType, isSlaBreach: isSlaTriggeredRule(r) });
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

export interface FlowNode {
  kind: "trigger" | "condition" | "action" | "cadence" | "stage"; label: string;
  /** Solo en nodos "cadence": id del ActionPlan enrolado (deep-link a Configuración). */
  planId?: string;
  /** Solo en nodos "trigger": true si la regla dispara por incumplimiento de SLA. */
  isSlaBreach?: boolean;
}
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
    flow.push({ kind: "trigger", label: `⚡ ${r.name} (${trigVal})`, isSlaBreach: isSlaTriggeredRule(r) });
    flow.push({ kind: "condition", label: filter.campaign ?? filter.contactType ?? "condición" });

    let stageEffect: string | null =
      r.triggerType === "LIFECYCLE_CHANGE" && typeof r.triggerConfig?.toStage === "string"
        ? (r.triggerConfig.toStage as string) : null;

    for (const a of collectActionNodes(safeActions(r))) {
      if (a.type === "ENROLL_PLAN") {
        const p = planById.get(String(a.config?.planId));
        flow.push({ kind: "cadence", label: `⟳ ${p ? p.name : "cadencia"}${p ? ` (${p.steps.length} pasos)` : ""}`, planId: p?.id });
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

// ─── Deep-link Journey ↔ Configuración (sub-block D) ──────────────────────────

export interface TargetedJourneyLink { mode: "targeted"; campaign: string }
export interface GeneralJourneyLink { mode: "general" }

/**
 * Decide cómo abrir una regla en el canvas de Journey al llegar desde Configuración
 * (?mode=targeted&ruleId=<id>). Si la regla referencia una campaña
 * (adAttribution.campaignName) en sus condiciones, se puede mostrar en la vista
 * Dirigida con esa campaña ya seleccionada. Si no (regla "general", sin segmento de
 * campaña), la vista Dirigida no tiene cómo filtrarla — degrada a General sin
 * crashear, en vez de forzar un estado inconsistente.
 */
export function resolveRuleJourneyLink(rule: RuleLite | undefined): TargetedJourneyLink | GeneralJourneyLink {
  if (!rule) return { mode: "general" };
  let campaign: string | undefined;
  walkConditions(rule.conditions, (leaf) => {
    if (!campaign && leaf.field === "adAttribution.campaignName" && typeof leaf.value === "string" && leaf.value) {
      campaign = leaf.value;
    }
  });
  return campaign ? { mode: "targeted", campaign } : { mode: "general" };
}

// ─── Panel SLA de solo lectura (sub-block A) ──────────────────────────────────

const OP_SHORT: Record<string, string> = {
  eq: "=", neq: "≠", gt: ">", gte: "≥", lt: "<", lte: "≤",
  in: "en", nin: "no en", contains: "contiene", changed_to: "cambió a",
};

/** Resumen corto y legible de un árbol de condiciones DSL (all/any, anidado). Puro. */
export function summarizeConditions(conditions: unknown): string {
  const parts: string[] = [];
  walkConditions(conditions, (leaf) => {
    if (!leaf.field) return;
    if (leaf.op === "exists") { parts.push(`${leaf.field} existe`); return; }
    const op = OP_SHORT[leaf.op ?? ""] ?? leaf.op ?? "";
    parts.push(`${leaf.field} ${op} ${leaf.value ?? ""}`.trim());
  });
  return parts.length ? parts.join(" · ") : "Sin condiciones (aplica siempre)";
}

/** Filas de solo lectura para el panel SLA del Journey: solo activas, resumen de segmento. */
export function deriveSlaPanel(policies: SlaPolicyLite[]): SlaPanelRow[] {
  return policies
    .filter((p) => p.isActive)
    .slice()
    .sort((a, b) => a.priority - b.priority)
    .map((p) => ({
      id: p.id, name: p.name, isDefault: p.isDefault, priority: p.priority,
      firstTouchMinutes: p.firstTouchMinutes, retryMinutes: p.retryMinutes, orphanHours: p.orphanHours,
      conditionsSummary: p.isDefault ? "Todos los contactos (default)" : summarizeConditions(p.conditions),
    }));
}
