// Lógica pura del builder visual de reglas (Fase 2). Sin React, sin BD → testeable.
import type { ConditionNode } from "@/lib/validations/rebuild-f1";

export type TriggerType =
  | "EVENT" | "STAGE_CHANGE" | "SCORE_THRESHOLD" | "INACTIVITY"
  | "SLA_BREACH" | "TIME" | "BEHAVIORAL";

export type Combinator = "all" | "any";

export interface CondLeaf { field: string; op: string; value: string }
export interface CondGroup { combinator: Combinator; conditions: CondLeaf[] }
export type CondItem = CondLeaf | CondGroup;
export interface ConditionTree { combinator: Combinator; items: CondItem[] }

export interface ActionRow { type: string; config: Record<string, string>; delayMinutes?: string }

export const DEAL_STAGES = [
  "NEW_LEAD", "CONTACTED", "DISCOVERY_DONE", "MEETING_SCHEDULED", "MEETING_COMPLETED",
  "PROPOSAL_SENT", "NEGOTIATION", "RESERVED", "CONTRACT_SIGNED", "CLOSING", "WON", "LOST", "FROZEN",
] as const;

export const FIELD_SUGGESTIONS = [
  "contact.score", "contact.temperature", "contact.contactStatus", "contact.contactType",
  "contact.urgency", "contact.budgetMax", "contact.leadSource",
  "adAttribution.campaignName", "adAttribution.adName", "adAttribution.adsetName", "adAttribution.network",
  "contact.custom.",
  "deal.stage", "deal.estimatedValue", "deal.dealType", "event.type",
];

export function isGroup(item: CondItem): item is CondGroup {
  return (item as CondGroup).combinator !== undefined;
}

// STAGE_CHANGE escribe `toStage` (motor en engine.ts lee `toStage`). Compat: parseTriggerValue lee `stage` como fallback para reglas antiguas.
export function buildTriggerConfig(triggerType: string, triggerValue: string): Record<string, unknown> {
  if (!triggerValue) return {};
  switch (triggerType) {
    case "EVENT": return { eventType: triggerValue };
    case "STAGE_CHANGE": return { toStage: triggerValue };
    case "SCORE_THRESHOLD": return { threshold: Number(triggerValue) || 0 };
    case "INACTIVITY": return { hours: Number(triggerValue) || 0 };
    default: return {};
  }
}

export function parseTriggerValue(rule: any): string {
  return String(
    rule?.triggerConfig?.eventType ?? rule?.triggerConfig?.toStage ?? rule?.triggerConfig?.stage ??
    rule?.triggerConfig?.threshold ?? rule?.triggerConfig?.hours ?? ""
  );
}

export function parseValue(op: string, raw: string): unknown {
  if (op === "exists") return true;
  if (op === "in" || op === "nin") return raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (/^-?\d+(\.\d+)?$/.test(raw.trim())) return Number(raw.trim());
  return raw;
}

// Versión plana (Task 1). Reemplazada por la versión con árbol en otra task.
export function buildConditions(combinator: Combinator, conds: CondLeaf[]): Record<string, unknown> {
  const valid = conds.filter((c) => c.field && c.op);
  if (valid.length === 0) return {};
  return { [combinator]: valid.map((c) => ({ field: c.field, op: c.op, value: parseValue(c.op, c.value) })) };
}

export function nodeToRows(conditions: any): { combinator: Combinator; rows: CondLeaf[] } {
  if (conditions && typeof conditions === "object") {
    const key = conditions.all ? "all" : conditions.any ? "any" : null;
    if (key) {
      const rows = (conditions[key] as any[])
        .filter((n) => n.field)
        .map((n) => ({ field: n.field, op: n.op, value: Array.isArray(n.value) ? n.value.join(",") : n.value != null ? String(n.value) : "" }));
      return { combinator: key, rows };
    }
  }
  return { combinator: "all", rows: [] };
}

function leafToDsl(c: CondLeaf) {
  return { field: c.field, op: c.op, value: parseValue(c.op, c.value) };
}

export function buildConditionsTree(tree: ConditionTree): Record<string, unknown> {
  const parts: unknown[] = [];
  for (const item of tree.items) {
    if (isGroup(item)) {
      const valid = item.conditions.filter((c) => c.field && c.op);
      if (valid.length > 0) parts.push({ [item.combinator]: valid.map(leafToDsl) });
    } else if (item.field && item.op) {
      parts.push(leafToDsl(item));
    }
  }
  if (parts.length === 0) return {};
  return { [tree.combinator]: parts };
}

function dslLeafToRow(n: any): CondLeaf {
  return { field: n.field, op: n.op, value: Array.isArray(n.value) ? n.value.join(",") : n.value != null ? String(n.value) : "" };
}

export function parseConditions(conditions: any): ConditionTree {
  if (conditions && typeof conditions === "object") {
    const key: Combinator | null = conditions.all ? "all" : conditions.any ? "any" : null;
    if (key) {
      const items: CondItem[] = (conditions[key] as any[]).map((n) => {
        const subKey: Combinator | null = n?.all ? "all" : n?.any ? "any" : null;
        if (subKey) return { combinator: subKey, conditions: (n[subKey] as any[]).filter((x) => x.field).map(dslLeafToRow) };
        return dslLeafToRow(n);
      }).filter((it) => isGroup(it) ? it.conditions.length > 0 : !!it.field);
      return { combinator: key, items };
    }
  }
  return { combinator: "all", items: [] };
}

export type { ConditionNode };
