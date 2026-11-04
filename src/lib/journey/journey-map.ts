// Capa de derivación del mapa de journey (sub-C.1). Puro: sin React, sin BD.
import { LIFECYCLE_ORDER, LIFECYCLE_LABELS, PIPELINE_STAGES, STAGE_LABELS } from "@/lib/constants";
import { describeTrigger } from "@/lib/workflows/trigger-catalog";

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

export type Lane = string; // etapa de lifecycle | etapa de pipeline | carril de disparador | "GENERAL"
export interface RuleNode {
  id: string; name: string; isActive: boolean; triggerType: string; isSlaBreach: boolean;
  /** Cadencias (ActionPlan) que enrola: la vista dibuja regla -> cadencia. */
  planIds?: string[];
  /** Carriles (etapas) a los que la regla mueve al contacto/negocio: regla -> etapa destino. */
  stageTargets?: Lane[];
}
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
const PIPELINE_CODES: string[] = PIPELINE_STAGES.map((s) => s.code);

// Carriles por "momento" para reglas cuyo disparador no apunta a una etapa concreta.
export const LANE_ENTRADA = "ENTRADA";
export const LANE_SEGUIMIENTO = "SEGUIMIENTO";
export const LANE_POSTVENTA = "POSTVENTA";
const LANE_LABELS: Record<string, string> = {
  [LANE_ENTRADA]: "Entrada de leads",
  [LANE_SEGUIMIENTO]: "Seguimiento",
  [LANE_POSTVENTA]: "Postventa",
  GENERAL: "General / Sin etapa",
};

/** Etiqueta legible de un carril (lifecycle, etapa de pipeline o carril por disparador). */
export function laneLabel(lane: Lane): string {
  return LANE_LABELS[lane] ?? LIFECYCLE_LABELS[lane] ?? STAGE_LABELS[lane] ?? lane;
}

// Orden de los carriles: entrada, ciclo de vida, pipeline, seguimiento, postventa, general.
const LANE_ORDER: Lane[] = [LANE_ENTRADA, ...STAGES, ...PIPELINE_CODES, LANE_SEGUIMIENTO, LANE_POSTVENTA, "GENERAL"];

// eventType del disparador -> carril "por momento" (solo si no hay etapa concreta).
const EVENT_LANE: Record<string, Lane> = {
  "lead.captured": LANE_ENTRADA, "lead.assigned": LANE_ENTRADA, "lead.reassigned": LANE_ENTRADA,
  "lead.orphaned": LANE_ENTRADA, "contact.created": LANE_ENTRADA, "contact.merged": LANE_ENTRADA,
  "whatsapp.replied": LANE_SEGUIMIENTO, "social.replied": LANE_SEGUIMIENTO, "contact.opted_out": LANE_SEGUIMIENTO,
  "quote.opened": LANE_SEGUIMIENTO, "visit.completed": LANE_SEGUIMIENTO, "deal.created": LANE_SEGUIMIENTO,
  "payment.overdue": LANE_POSTVENTA, "deal.won": LANE_POSTVENTA,
};

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

/**
 * Carril al que pertenece una regla. Prioridad (E4 #3):
 *  1. disparador de etapa: LIFECYCLE_CHANGE (lifecycle) o STAGE_CHANGE (pipeline) con toStage valido;
 *  2. accion SET_LIFECYCLE (la ultima gana), luego CHANGE_STAGE (pipeline, la ultima gana);
 *  3. eventType del disparador -> "Entrada de leads" / "Seguimiento" / "Postventa"
 *     (INACTIVITY, TIME, SLA_BREACH y BEHAVIORAL caen en "Seguimiento");
 *  4. "GENERAL" si no hay senal.
 */
export function ruleStage(rule: RuleLite): Lane {
  const t = rule.triggerConfig?.toStage;
  if (rule.triggerType === "LIFECYCLE_CHANGE" && typeof t === "string" && STAGES.includes(t)) return t;
  if (rule.triggerType === "STAGE_CHANGE" && typeof t === "string" && PIPELINE_CODES.includes(t)) return t;
  let lifecycle: Lane | null = null;
  let pipeline: Lane | null = null;
  for (const a of collectActionNodes(safeActions(rule))) {
    const s = a.config?.toStage;
    if (a.type === "SET_LIFECYCLE" && typeof s === "string" && STAGES.includes(s)) lifecycle = s; // ultima gana
    if ((a.type === "CHANGE_STAGE" || a.type === "STAGE_CHANGE") && typeof s === "string" && PIPELINE_CODES.includes(s)) pipeline = s;
  }
  if (lifecycle) return lifecycle;
  if (pipeline) return pipeline;
  const ev = rule.triggerConfig?.eventType;
  if (typeof ev === "string" && EVENT_LANE[ev]) return EVENT_LANE[ev];
  if (["INACTIVITY", "TIME", "SLA_BREACH", "BEHAVIORAL"].includes(rule.triggerType)) return LANE_SEGUIMIENTO;
  return "GENERAL";
}

/** Carriles destino de una regla: etapas (lifecycle o pipeline) a las que mueve al contacto/negocio. */
function stageTargetsOf(rule: RuleLite): Lane[] {
  const out: Lane[] = [];
  for (const a of collectActionNodes(safeActions(rule))) {
    const s = a.config?.toStage;
    if (typeof s !== "string") continue;
    const ok = (a.type === "SET_LIFECYCLE" && STAGES.includes(s)) ||
      ((a.type === "CHANGE_STAGE" || a.type === "STAGE_CHANGE") && PIPELINE_CODES.includes(s));
    if (ok && !out.includes(s)) out.push(s);
  }
  return out;
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
    const planIds = planIdsEnrolledBy(r);
    ensure(stage).rules.push({
      id: r.id, name: r.name, isActive: r.isActive, triggerType: r.triggerType, isSlaBreach: isSlaTriggeredRule(r),
      planIds, stageTargets: stageTargetsOf(r),
    });
    for (const pid of planIds) {
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

  const lanes = LANE_ORDER
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
export interface TargetedView {
  flows: FlowNode[][];
  /** Id de regla de cada flujo (paralelo a `flows`): da IDs de nodo estables al adaptador (E4 #11). */
  ruleIds?: string[];
}
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

/** Flujo lineal disparador, condicion, acciones y etapa de UNA regla. */
function flowForRule(r: RuleLite, planById: Map<string, PlanLite>, triggerLabel: string, conditionLabel: string): FlowNode[] {
  const flow: FlowNode[] = [];
  flow.push({ kind: "trigger", label: triggerLabel, isSlaBreach: isSlaTriggeredRule(r) });
  flow.push({ kind: "condition", label: conditionLabel });

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
  return flow;
}

export function buildTargetedView(rules: RuleLite[], plans: PlanLite[], filter: TargetedFilter): TargetedView {
  const planById = new Map(plans.map((p) => [p.id, p]));
  const flows: FlowNode[][] = [];
  const ruleIds: string[] = [];

  for (const r of rules) {
    if (!ruleMatchesFilter(r, filter)) continue;
    const trigVal = (r.triggerConfig?.eventType ?? r.triggerConfig?.toStage ?? r.triggerType) as string;
    flows.push(flowForRule(r, planById, `⚡ ${r.name} (${trigVal})`, filter.campaign ?? filter.contactType ?? "condición"));
    ruleIds.push(r.id);
  }
  return { flows, ruleIds };
}

/**
 * Vista de UNA regla, sin exigir campana (E4 #2): Dirigida "por regla". Cuando ninguna regla
 * segmenta por campana, esta es la forma de ver el flujo de cualquiera. Si la regla no existe,
 * devuelve un mapa vacio.
 */
export function buildRuleView(rules: RuleLite[], plans: PlanLite[], ruleId: string): TargetedView {
  const r = rules.find((x) => x.id === ruleId);
  if (!r) return { flows: [], ruleIds: [] };
  const planById = new Map(plans.map((p) => [p.id, p]));
  const cond = summarizeConditions(r.conditions);
  return {
    flows: [flowForRule(r, planById, `⚡ ${r.name}: cuando ${describeTrigger(r.triggerType, r.triggerConfig)}`, cond)],
    ruleIds: [r.id],
  };
}

// ─── Deep-link Journey ↔ Configuración (sub-block D) ──────────────────────────

export interface GeneralJourneyLink { mode: "general" }
/** Deep-link a una regla concreta: se abre SIEMPRE en edicion, con o sin campana (E4 #1). */
export interface RuleJourneyLink { mode: "targeted"; ruleId: string; campaign: string }
/** @deprecated Alias de RuleJourneyLink (misma forma + ruleId). */
export type TargetedJourneyLink = RuleJourneyLink;

/**
 * Campana de la regla (adAttribution.campaignName) o "" si no segmenta por campana.
 * Sirve solo para preseleccionar el filtro de lectura; ya NO decide si la regla se abre.
 */
export function campaignOfRule(rule: RuleLite | undefined): string {
  if (!rule) return "";
  let campaign = "";
  walkConditions(rule.conditions, (leaf) => {
    if (!campaign && leaf.field === "adAttribution.campaignName" && typeof leaf.value === "string" && leaf.value) {
      campaign = leaf.value;
    }
  });
  return campaign;
}

/**
 * Decide como abrir /journey?mode=targeted&ruleId=<id> (E4 #1). Antes, una regla sin campana
 * "degradaba" a General y no pasaba nada. Ahora: si la regla existe, SIEMPRE se abre (la edicion
 * no necesita campana); si no existe, vuelve a General y la vista avisa.
 */
export function resolveRuleJourneyLink(rule: RuleLite | undefined): RuleJourneyLink | GeneralJourneyLink {
  if (!rule) return { mode: "general" };
  return { mode: "targeted", ruleId: rule.id, campaign: campaignOfRule(rule) };
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
