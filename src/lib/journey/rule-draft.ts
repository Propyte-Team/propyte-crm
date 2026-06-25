// Núcleo puro del canvas editable (C.2-i2). Sin React, sin React Flow.
// El draft tiene la MISMA forma que AutomationRule → round-trip exacto.
import { conditionsDslSchema } from "@/lib/validations/rebuild-f1";
import type { z } from "zod";

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
