// Núcleo puro del canvas editable (C.2-i2). Sin React, sin React Flow.
// El draft tiene la MISMA forma que AutomationRule → round-trip exacto.
import { conditionsDslSchema } from "@/lib/validations/rebuild-f1";
import type { WorkflowNode } from "@/lib/validations/rebuild-f1";
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
  actions: WorkflowNode[];
  cooldownMinutes: number | null;
  priority: number;
  isActive: boolean;
}

// ─── Draft tree types ─────────────────────────────────────────────────────────

export interface ActionNodeDraft {
  nodeId: string;
  kind?: "action";
  type: string;
  config: Record<string, unknown>;
  delayMinutes?: number;
  autonomyLevel?: string;
}

export interface BranchDraft {
  branchId: string;
  label?: string;
  conditions: Conditions;
  steps: NodeDraft[];
}

export interface DecisionNodeDraft {
  nodeId: string;
  kind: "decision";
  label?: string;
  branches: BranchDraft[];
  else?: NodeDraft[];
}

export type NodeDraft = ActionNodeDraft | DecisionNodeDraft;

export function isDecisionDraft(n: NodeDraft): n is DecisionNodeDraft {
  return n.kind === "decision";
}

/** @deprecated Use NodeDraft instead. Kept for backward compat until T8/T9. */
export type ActionDraft = ActionNodeDraft;

export interface RuleDraft {
  id?: string;
  name: string;
  description: string | null;
  triggerType: string;
  triggerConfig: Record<string, unknown>;
  conditions: Conditions;
  actions: NodeDraft[];
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
  actions: WorkflowNode[];
  cooldownMinutes: number | null;
  priority: number;
  isActive: boolean;
}

// ─── Recursive helpers ────────────────────────────────────────────────────────

function nodeToDraft(node: WorkflowNode, path: string): NodeDraft {
  if ((node as { kind?: string }).kind === "decision") {
    const d = node as Extract<WorkflowNode, { kind: "decision" }>;
    return {
      nodeId: path,
      kind: "decision",
      ...(d.label !== undefined ? { label: d.label } : {}),
      branches: d.branches.map((b, bi) => ({
        branchId: `${path}.b${bi}`,
        ...(b.label !== undefined ? { label: b.label } : {}),
        conditions: (b.conditions ?? {}) as Conditions,
        steps: b.steps.map((s, si) => nodeToDraft(s, `${path}.b${bi}.${si}`)),
      })),
      ...(d.else ? { else: d.else.map((s, si) => nodeToDraft(s, `${path}.else.${si}`)) } : {}),
    };
  }
  const a = node as Extract<WorkflowNode, { type: string }>;
  return {
    nodeId: path,
    type: a.type,
    config: (a.config ?? {}) as Record<string, unknown>,
    ...(a.delayMinutes !== undefined ? { delayMinutes: a.delayMinutes } : {}),
    ...((a as { autonomyLevel?: string }).autonomyLevel !== undefined
      ? { autonomyLevel: (a as { autonomyLevel?: string }).autonomyLevel }
      : {}),
  };
}

function draftToNode(n: NodeDraft): WorkflowNode {
  if (isDecisionDraft(n)) {
    return {
      kind: "decision",
      ...(n.label !== undefined ? { label: n.label } : {}),
      branches: n.branches.map((b) => ({
        ...(b.label !== undefined ? { label: b.label } : {}),
        conditions: b.conditions,
        steps: b.steps.map(draftToNode),
      })),
      ...(n.else ? { else: n.else.map(draftToNode) } : {}),
    } as WorkflowNode;
  }
  return {
    type: n.type,
    config: n.config,
    ...(n.delayMinutes !== undefined ? { delayMinutes: n.delayMinutes } : {}),
    ...(n.autonomyLevel !== undefined ? { autonomyLevel: n.autonomyLevel } : {}),
  } as WorkflowNode;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function ruleToDraft(row: RuleRow): RuleDraft {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    triggerType: row.triggerType,
    triggerConfig: row.triggerConfig ?? {},
    conditions: row.conditions ?? {},
    actions: (Array.isArray(row.actions) ? row.actions : []).map((n, i) =>
      nodeToDraft(n, `a${i}`),
    ),
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
  for (const n of draft.actions) {
    if (isDecisionDraft(n)) {
      // Decision nodes: flat representation for legacy flow (T8 will rewrite)
      push(n.nodeId, "decision", { label: n.label, branches: n.branches });
    } else {
      const a = n as ActionNodeDraft;
      const isStage = a.type === "CHANGE_STAGE";
      push(a.nodeId, isStage ? "stage" : "action", { actionType: a.type, config: a.config, delayMinutes: a.delayMinutes });
    }
  }
  for (let i = 1; i < nodes.length; i++) {
    edges.push({ id: `${nodes[i - 1].id}->${nodes[i].id}`, source: nodes[i - 1].id, target: nodes[i].id });
  }
  return { nodes, edges };
}

// Pure edit ops (tree-aware, T8)

// Reasigna TODOS los ids de forma estable, igual que ruleToDraft.
function rebuildBranchIds(nodes: NodeDraft[], prefix = ""): NodeDraft[] {
  return nodes.map((n, i) => {
    const path = prefix ? `${prefix}.${i}` : `a${i}`;
    if (isDecisionDraft(n)) {
      return {
        ...n, nodeId: path,
        branches: n.branches.map((b, bi) => ({ ...b, branchId: `${path}.b${bi}`, steps: rebuildBranchIds(b.steps, `${path}.b${bi}`) })),
        ...(n.else ? { else: rebuildBranchIds(n.else, `${path}.else`) } : {}),
      };
    }
    return { ...n, nodeId: path };
  });
}

// Aplica fn al nodo con nodeId == id en cualquier nivel.
function mapNodeById(nodes: NodeDraft[], id: string, fn: (n: NodeDraft) => NodeDraft): NodeDraft[] {
  return nodes.map((n) => {
    if (n.nodeId === id) return fn(n);
    if (isDecisionDraft(n)) {
      return {
        ...n,
        branches: n.branches.map((b) => ({ ...b, steps: mapNodeById(b.steps, id, fn) })),
        ...(n.else ? { else: mapNodeById(n.else, id, fn) } : {}),
      };
    }
    return n;
  });
}

// Aplica fn a la rama con branchId == bid en cualquier decision del arbol.
function mapBranchById(nodes: NodeDraft[], bid: string, fn: (b: BranchDraft) => BranchDraft): NodeDraft[] {
  return nodes.map((n) => {
    if (isDecisionDraft(n)) {
      return {
        ...n,
        branches: n.branches.map((b) => (b.branchId === bid ? fn(b) : { ...b, steps: mapBranchById(b.steps, bid, fn) })),
        ...(n.else ? { else: mapBranchById(n.else, bid, fn) } : {}),
      };
    }
    return n;
  });
}

// Elimina el nodo con nodeId == id en cualquier nivel.
function filterNodeById(nodes: NodeDraft[], id: string): NodeDraft[] {
  return nodes
    .filter((n) => n.nodeId !== id)
    .map((n) =>
      isDecisionDraft(n)
        ? {
            ...n,
            branches: n.branches.map((b) => ({ ...b, steps: filterNodeById(b.steps, id) })),
            ...(n.else ? { else: filterNodeById(n.else, id) } : {}),
          }
        : n,
    );
}

export function addAction(draft: RuleDraft, type: string): RuleDraft {
  return { ...draft, actions: rebuildBranchIds([...draft.actions, { nodeId: "", type, config: {} }]) };
}
export function insertAction(draft: RuleDraft, type: string, atIndex: number): RuleDraft {
  const i = Math.max(0, Math.min(atIndex, draft.actions.length));
  const next = [...draft.actions];
  next.splice(i, 0, { nodeId: "", type, config: {} });
  return { ...draft, actions: rebuildBranchIds(next) };
}
export function addDecision(draft: RuleDraft): RuleDraft {
  const dec: DecisionNodeDraft = { nodeId: "", kind: "decision", branches: [{ branchId: "", conditions: {} as Conditions, steps: [] }] };
  return { ...draft, actions: rebuildBranchIds([...draft.actions, dec]) };
}
export function removeNode(draft: RuleDraft, nodeId: string): RuleDraft {
  return { ...draft, actions: rebuildBranchIds(filterNodeById(draft.actions, nodeId)) };
}
export function reorderAction(draft: RuleDraft, nodeId: string, dir: "up" | "down"): RuleDraft {
  const i = draft.actions.findIndex((a) => a.nodeId === nodeId);
  if (i < 0) return draft;
  const j = dir === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= draft.actions.length) return draft;
  const next = [...draft.actions];
  [next[i], next[j]] = [next[j], next[i]];
  return { ...draft, actions: rebuildBranchIds(next) };
}
export function setActionConfig(draft: RuleDraft, nodeId: string, patch: Record<string, unknown>): RuleDraft {
  return { ...draft, actions: mapNodeById(draft.actions, nodeId, (n) => (isDecisionDraft(n) ? n : { ...n, config: { ...n.config, ...patch } })) };
}
export function setActionType(draft: RuleDraft, nodeId: string, type: string): RuleDraft {
  return { ...draft, actions: mapNodeById(draft.actions, nodeId, (n) => (isDecisionDraft(n) ? n : { ...n, type, config: {} })) };
}
export function setActionDelay(draft: RuleDraft, nodeId: string, minutes: number): RuleDraft {
  return { ...draft, actions: mapNodeById(draft.actions, nodeId, (n) => (isDecisionDraft(n) ? n : { ...n, delayMinutes: minutes })) };
}
export function setDecisionLabel(draft: RuleDraft, nodeId: string, label: string): RuleDraft {
  return { ...draft, actions: mapNodeById(draft.actions, nodeId, (n) => (isDecisionDraft(n) ? { ...n, label } : n)) };
}
export function addBranch(draft: RuleDraft, decisionNodeId: string): RuleDraft {
  return {
    ...draft,
    actions: rebuildBranchIds(mapNodeById(draft.actions, decisionNodeId, (n) =>
      isDecisionDraft(n) ? { ...n, branches: [...n.branches, { branchId: "", conditions: {} as Conditions, steps: [] }] } : n,
    )),
  };
}
export function removeBranch(draft: RuleDraft, branchId: string): RuleDraft {
  const drop = (nodes: NodeDraft[]): NodeDraft[] =>
    nodes.map((n) => {
      if (isDecisionDraft(n)) {
        const kept = n.branches.filter((b) => b.branchId !== branchId);
        const branches = kept.length > 0 ? kept.map((b) => ({ ...b, steps: drop(b.steps) })) : [{ branchId: "", conditions: {} as Conditions, steps: [] }];
        return { ...n, branches, ...(n.else ? { else: drop(n.else) } : {}) };
      }
      return n;
    });
  return { ...draft, actions: rebuildBranchIds(drop(draft.actions)) };
}
export function setBranchConditions(draft: RuleDraft, branchId: string, conditions: Conditions): RuleDraft {
  return { ...draft, actions: mapBranchById(draft.actions, branchId, (b) => ({ ...b, conditions })) };
}
export function setBranchLabel(draft: RuleDraft, branchId: string, label: string): RuleDraft {
  return { ...draft, actions: mapBranchById(draft.actions, branchId, (b) => ({ ...b, label })) };
}
export function addActionToBranch(draft: RuleDraft, branchId: string, type: string): RuleDraft {
  return { ...draft, actions: rebuildBranchIds(mapBranchById(draft.actions, branchId, (b) => ({ ...b, steps: [...b.steps, { nodeId: "", type, config: {} }] }))) };
}
/** @deprecated Use removeNode instead. Kept for backward compat with use-rule-draft.ts. */
export const removeAction = removeNode;

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
    actions: draft.actions.map(draftToNode),
    cooldownMinutes: draft.cooldownMinutes,
    priority: draft.priority,
    isActive: draft.isActive,
  };
  if (draft.id) payload.id = draft.id;
  return payload;
}
