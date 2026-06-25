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
