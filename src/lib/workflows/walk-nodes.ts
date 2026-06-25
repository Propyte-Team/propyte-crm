// Walker recursivo PURO del árbol de nodos de una AutomationRule (ramas).
// Entra: árbol de WorkflowNode + contexto del DSL. Sale: solo las acciones del
// camino tomado, cada una con su `path` estable (para dedupeKey idempotente).
// Sin BD, sin React → 100% testeable.
import type { WorkflowNode } from "@/lib/validations/rebuild-f1";
import { evaluateConditions } from "./evaluate-conditions";

export interface EnqueueSpec {
  actionType: string;
  config: Record<string, unknown>;
  delayMinutes?: number;
  autonomyLevel?: string;
  path: string;
}

type Ctx = Record<string, unknown>;

function isDecision(n: WorkflowNode): n is Extract<WorkflowNode, { kind: "decision" }> {
  return (n as { kind?: string }).kind === "decision";
}

export function walkNodes(nodes: WorkflowNode[], ctx: Ctx, prefix = ""): EnqueueSpec[] {
  const out: EnqueueSpec[] = [];
  nodes.forEach((node, i) => {
    const path = prefix ? `${prefix}.${i}` : String(i);
    if (isDecision(node)) {
      const branch = node.branches.find((b) => evaluateConditions(b.conditions as never, ctx));
      if (branch) {
        const bi = node.branches.indexOf(branch);
        out.push(...walkNodes(branch.steps, ctx, `${path}.b${bi}`));
      } else if (node.else && node.else.length > 0) {
        out.push(...walkNodes(node.else, ctx, `${path}.else`));
      }
      return;
    }
    const action = node as Extract<WorkflowNode, { type: string }>;
    out.push({
      actionType: action.type,
      config: (action.config ?? {}) as Record<string, unknown>,
      ...(action.delayMinutes !== undefined ? { delayMinutes: action.delayMinutes } : {}),
      ...(action.autonomyLevel !== undefined ? { autonomyLevel: action.autonomyLevel } : {}),
      path,
    });
  });
  return out;
}
