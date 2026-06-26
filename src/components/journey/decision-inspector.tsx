"use client";
import type { DecisionNodeDraft, BranchDraft, Conditions } from "@/lib/journey/rule-draft";
import { ConditionTreeEditor } from "@/components/config/condition-tree";
import { parseConditions, buildConditionsTree } from "@/lib/workflows/builder-model";

interface DecisionOps {
  setDecisionLabel: (nodeId: string, label: string) => void;
  addBranch: (decisionNodeId: string) => void;
  removeBranch: (branchId: string) => void;
  setBranchLabel: (branchId: string, label: string) => void;
  setBranchConditions: (branchId: string, c: Conditions) => void;
}

export function DecisionInspector({ decision, ops }: { decision: DecisionNodeDraft; ops: DecisionOps }) {
  return (
    <aside className="journey-inspector">
      <h3 className="label">◆ Decisión</h3>
      <input
        className="form-input"
        placeholder="Nombre (p. ej. Por origen)"
        value={decision.label ?? ""}
        onChange={(e) => ops.setDecisionLabel(decision.nodeId, e.target.value)}
      />
      {decision.branches.map((b: BranchDraft, i: number) => (
        <div key={b.branchId} className="decision-branch" style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border, #e5e5e5)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <input
              className="form-input"
              placeholder={`Rama ${i + 1}`}
              value={b.label ?? ""}
              onChange={(e) => ops.setBranchLabel(b.branchId, e.target.value)}
            />
            <button type="button" className="btn-secondary" onClick={() => ops.removeBranch(b.branchId)}>Quitar rama</button>
          </div>
          <ConditionTreeEditor
            tree={parseConditions(b.conditions)}
            onChange={(tree) => ops.setBranchConditions(b.branchId, buildConditionsTree(tree) as Conditions)}
            label="Si cumple…"
          />
          <p className="label" style={{ marginTop: 6 }}>
            {b.steps.length} acción(es) en esta rama — edítalas seleccionando sus nodos en el lienzo.
          </p>
        </div>
      ))}
      <button type="button" className="btn-secondary" style={{ marginTop: 12 }} onClick={() => ops.addBranch(decision.nodeId)}>+ Añadir rama</button>
    </aside>
  );
}
