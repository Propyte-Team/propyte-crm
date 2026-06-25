// Núcleo puro del canvas editable (C.2-i2). Sin React, sin React Flow.
// El draft tiene la MISMA forma que AutomationRule → round-trip exacto.
import { conditionsDslSchema } from "@/lib/validations/rebuild-f1";
import type { z } from "zod";
import type { Flow, RFNode, RFEdge } from "./flow-adapter";

export type Conditions = z.infer<typeof conditionsDslSchema>;

export interface RuleRow {
  id: string;
  name: string;
  description: string | null;
  triggerType: string;
  triggerConfig: Record<string, unknown>;
  conditions: Conditions;
  actions: { type: string; config?: Record<string, unknown>; delayMinutes?: number }[];
  cooldownMinutes: number | null;
  priority: number;
  isActive: boolean;
}

export interface ActionDraft {
  nodeId: string;
  type: string;
  config: Record<string, unknown>;
  delayMinutes?: number;
}

export interface RuleDraft {
  id?: string;
  name: string;
  description: string | null;
  triggerType: string;
  triggerConfig: Record<string, unknown>;
  conditions: Conditions;
  actions: ActionDraft[];
  cooldownMinutes: number | null;
  priority: number;
  isActive: boolean;
}

export interface RulePayload {
  id?: string;
  name: string;
  description: string | null;
  triggerType: string;
  triggerConfig: Record<string, unknown>;
  conditions: Conditions;
  actions: { type: string; config: Record<string, unknown>; delayMinutes?: number }[];
  cooldownMinutes: number | null;
  priority: number;
  isActive: boolean;
}

export function ruleToDraft(row: RuleRow): RuleDraft {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    triggerType: row.triggerType,
    triggerConfig: row.triggerConfig ?? {},
    conditions: row.conditions ?? {},
    actions: (Array.isArray(row.actions) ? row.actions : []).map((a, i) => ({
      nodeId: `a${i}`,
      type: a.type,
      config: a.config ?? {},
      ...(a.delayMinutes !== undefined ? { delayMinutes: a.delayMinutes } : {}),
    })),
    cooldownMinutes: row.cooldownMinutes,
    priority: row.priority,
    isActive: row.isActive,
  };
}

const LANE_W = 240;

function conditionsEmpty(c: Conditions): boolean {
  if (!c || typeof c !== "object") return true;
  const o = c as Record<string, unknown>;
  const all = Array.isArray(o.all) ? o.all.length : 0;
  const any = Array.isArray(o.any) ? o.any.length : 0;
  return all === 0 && any === 0 && typeof o.field !== "string";
}

export function draftToFlow(draft: RuleDraft): Flow {
  const nodes: RFNode[] = [];
  const edges: RFEdge[] = [];
  let x = 0;
  const push = (id: string, type: string, data: Record<string, unknown>) => {
    nodes.push({ id, type, position: { x: x * LANE_W, y: 0 }, data });
    x++;
  };
  push("trigger", "trigger", { triggerType: draft.triggerType, triggerConfig: draft.triggerConfig, label: draft.name });
  if (!conditionsEmpty(draft.conditions)) {
    push("condition", "condition", { conditions: draft.conditions });
  }
  for (const a of draft.actions) {
    const isStage = a.type === "CHANGE_STAGE";
    push(a.nodeId, isStage ? "stage" : "action", { actionType: a.type, config: a.config, delayMinutes: a.delayMinutes });
  }
  for (let i = 1; i < nodes.length; i++) {
    edges.push({ id: `${nodes[i - 1].id}->${nodes[i].id}`, source: nodes[i - 1].id, target: nodes[i].id });
  }
  return { nodes, edges };
}

// ─── Pure edit ops ───────────────────────────────────────────────────────────

function reindex(actions: ActionDraft[]): ActionDraft[] {
  return actions.map((a, i) => ({ ...a, nodeId: `a${i}` }));
}

export function addAction(draft: RuleDraft, type: string): RuleDraft {
  return { ...draft, actions: reindex([...draft.actions, { nodeId: "", type, config: {} }]) };
}

export function insertAction(draft: RuleDraft, type: string, atIndex: number): RuleDraft {
  const i = Math.max(0, Math.min(atIndex, draft.actions.length));
  const next = [...draft.actions];
  next.splice(i, 0, { nodeId: "", type, config: {} });
  return { ...draft, actions: reindex(next) };
}

export function removeAction(draft: RuleDraft, nodeId: string): RuleDraft {
  return { ...draft, actions: reindex(draft.actions.filter((a) => a.nodeId !== nodeId)) };
}

export function reorderAction(draft: RuleDraft, nodeId: string, dir: "up" | "down"): RuleDraft {
  const i = draft.actions.findIndex((a) => a.nodeId === nodeId);
  if (i < 0) return draft;
  const j = dir === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= draft.actions.length) return draft;
  const next = [...draft.actions];
  [next[i], next[j]] = [next[j], next[i]];
  return { ...draft, actions: reindex(next) };
}

export function setActionConfig(draft: RuleDraft, nodeId: string, patch: Record<string, unknown>): RuleDraft {
  return {
    ...draft,
    actions: draft.actions.map((a) =>
      a.nodeId === nodeId ? { ...a, config: { ...a.config, ...patch } } : a,
    ),
  };
}

export function setActionType(draft: RuleDraft, nodeId: string, type: string): RuleDraft {
  return {
    ...draft,
    actions: draft.actions.map((a) => (a.nodeId === nodeId ? { ...a, type, config: {} } : a)),
  };
}

export function setActionDelay(draft: RuleDraft, nodeId: string, minutes: number): RuleDraft {
  return {
    ...draft,
    actions: draft.actions.map((a) => (a.nodeId === nodeId ? { ...a, delayMinutes: minutes } : a)),
  };
}

export function setTrigger(
  draft: RuleDraft,
  t: { triggerType: string; triggerConfig: Record<string, unknown> },
): RuleDraft {
  return { ...draft, triggerType: t.triggerType, triggerConfig: t.triggerConfig };
}

export function setConditions(draft: RuleDraft, conditions: Conditions): RuleDraft {
  return { ...draft, conditions };
}

export function setMeta(
  draft: RuleDraft,
  patch: Partial<Pick<RuleDraft, "name" | "description" | "priority" | "cooldownMinutes" | "isActive">>,
): RuleDraft {
  return { ...draft, ...patch };
}

/** Draft mínimo válido para una regla nueva (trigger + 1 acción CHANGE_STAGE). */
export function newRuleDraft(): RuleDraft {
  return {
    id: undefined,
    name: "",
    description: null,
    triggerType: "EVENT",
    triggerConfig: {},
    conditions: {} as Conditions,
    actions: [{ nodeId: "a0", type: "CHANGE_STAGE", config: {} }],
    cooldownMinutes: null,
    priority: 100,
    isActive: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

export function draftToRulePayload(draft: RuleDraft): RulePayload {
  const payload: RulePayload = {
    name: draft.name,
    description: draft.description,
    triggerType: draft.triggerType,
    triggerConfig: draft.triggerConfig,
    conditions: draft.conditions,
    actions: draft.actions.map((a) => ({
      type: a.type,
      config: a.config,
      ...(a.delayMinutes !== undefined ? { delayMinutes: a.delayMinutes } : {}),
    })),
    cooldownMinutes: draft.cooldownMinutes,
    priority: draft.priority,
    isActive: draft.isActive,
  };
  if (draft.id) payload.id = draft.id;
  return payload;
}
