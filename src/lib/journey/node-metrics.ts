// Cómputo PURO de métricas por nodo a partir de los conteos crudos de ActionQueue.
// Mapea ruta del dedupeKey (raíz numérica) → nodeId del canvas (raíz con prefijo "a").
import type { RuleDraft, NodeDraft } from "./rule-draft";
import { isDecisionDraft } from "./rule-draft";

export interface RawMetrics {
  counts: Record<string, number>;
  total: number;
}
export interface NodeMetrics {
  nodeVolumes: Record<string, number>;
  branchSplits: Record<string, { count: number; pct: number }>;
}

export function computeNodeMetrics(draft: RuleDraft, raw: RawMetrics): NodeMetrics {
  const nodeVolumes: Record<string, number> = {};
  const branchSplits: Record<string, { count: number; pct: number }> = {};

  for (const [path, n] of Object.entries(raw.counts)) {
    nodeVolumes[`a${path}`] = n;
  }

  function volumeOf(node: NodeDraft): number {
    if (!isDecisionDraft(node)) {
      const v = nodeVolumes[node.nodeId] ?? 0;
      nodeVolumes[node.nodeId] = v;
      return v;
    }
    const branchEntry = (steps: NodeDraft[]): number => (steps.length > 0 ? volumeOf(steps[0]) : 0);
    const branchCounts = node.branches.map((b) => ({ branchId: b.branchId, count: branchEntry(b.steps) }));
    const elseCount = node.else && node.else.length > 0 ? branchEntry(node.else) : 0;
    // Recorre TODOS los pasos (no solo el primero) para que los nodos-acción intermedios
    // de cada rama/else también queden poblados en nodeVolumes.
    for (const b of node.branches) for (const s of b.steps) volumeOf(s);
    if (node.else) for (const s of node.else) volumeOf(s);

    const denom = branchCounts.reduce((a, b) => a + b.count, 0) + elseCount;
    for (const bc of branchCounts) {
      branchSplits[bc.branchId] = { count: bc.count, pct: denom > 0 ? Math.round((bc.count / denom) * 100) : 0 };
    }
    if (node.else && node.else.length > 0) {
      branchSplits[`${node.nodeId}.else`] = { count: elseCount, pct: denom > 0 ? Math.round((elseCount / denom) * 100) : 0 };
    }
    nodeVolumes[node.nodeId] = denom;
    return denom;
  }
  for (const n of draft.actions) volumeOf(n);

  nodeVolumes["trigger"] = raw.total;
  nodeVolumes["condition"] = raw.total;
  return { nodeVolumes, branchSplits };
}
