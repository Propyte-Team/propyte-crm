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

function delayDeConfig(config: unknown): number | undefined {
  const d = (config as { delayMinutes?: unknown } | null | undefined)?.delayMinutes;
  return typeof d === "number" && Number.isFinite(d) && d > 0 ? d : undefined;
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
    // Retraso: el de primer nivel manda; si no, `config.delayMinutes` (así lo dejó el seed de WF5/WF6/WF8
    // en prod). Se lee aquí para que motor y scheduler lo respeten sin duplicar la regla.
    const delay = action.delayMinutes ?? delayDeConfig(action.config);
    out.push({
      actionType: action.type,
      config: (action.config ?? {}) as Record<string, unknown>,
      ...(delay !== undefined ? { delayMinutes: delay } : {}),
      ...(action.autonomyLevel !== undefined ? { autonomyLevel: action.autonomyLevel } : {}),
      path,
    });
  });
  return out;
}
