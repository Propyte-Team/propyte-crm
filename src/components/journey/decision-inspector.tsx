"use client";
import type { DecisionNodeDraft, BranchDraft, Conditions } from "@/lib/journey/rule-draft";
import { ConditionTreeEditor } from "@/components/config/condition-tree";
import { buildConditionsTreeGuiado } from "@/components/config/condition-tree-model";
import { parseConditions } from "@/lib/workflows/builder-model";
import type { ContextoDeCondicion } from "@/lib/workflows/condition-catalog";
import { tituloDeRama } from "./rule-inspector-model";

interface DecisionOps {
  setDecisionLabel: (nodeId: string, label: string) => void;
  addBranch: (decisionNodeId: string) => void;
  removeBranch: (branchId: string) => void;
  setBranchLabel: (branchId: string, label: string) => void;
  setBranchConditions: (branchId: string, c: Conditions) => void;
  addActionToBranch: (branchId: string, type: string) => void;
  addActionToElse: (decisionNodeId: string, type: string) => void;
  setElseEnabled: (decisionNodeId: string, enabled: boolean) => void;
}

const BOTON = "btn-secondary !min-h-0 !px-2.5 !py-1 !text-[12px]";
const ETIQUETA = "block text-[12px] font-medium text-[color:var(--text-secondary)]";
const AYUDA = "text-[11px] text-[color:var(--text-tertiary)]";

export function DecisionInspector({
  decision, ops, contexto = "contact",
}: {
  decision: DecisionNodeDraft;
  ops: DecisionOps;
  /** Datos que ofrecen las condiciones; sale del disparador de la regla. */
  contexto?: ContextoDeCondicion;
}) {
  return (
    <aside className="crm-card !p-4 space-y-3 text-[12px]">
      <h3 className="text-[12px] font-semibold uppercase tracking-wider text-[color:var(--text-tertiary)]">Decisión</h3>
      <div className="space-y-1">
        <label htmlFor="insp-decision" className={ETIQUETA}>Nombre</label>
        <input
          id="insp-decision"
          className="form-input text-[13px]"
          placeholder="Por ejemplo: Por origen"
          value={decision.label ?? ""}
          onChange={(e) => ops.setDecisionLabel(decision.nodeId, e.target.value)}
        />
        <p className={AYUDA}>Se revisan las ramas en orden y corre la primera que se cumpla.</p>
      </div>

      {decision.branches.map((b: BranchDraft, i: number) => (
        <div key={b.branchId} className="space-y-2 border-t pt-3" style={{ borderColor: "var(--border-subtle)" }}>
          <p className="text-[13px] font-medium text-[color:var(--text-primary)]">{tituloDeRama(b, i)}</p>
          <div className="flex items-center gap-2">
            <input
              className="form-input text-[13px]"
              placeholder={`Nombre de la rama ${i + 1} (opcional)`}
              aria-label={`Nombre de la rama ${i + 1}`}
              value={b.label ?? ""}
              onChange={(e) => ops.setBranchLabel(b.branchId, e.target.value)}
            />
            <button type="button" className={BOTON} onClick={() => ops.removeBranch(b.branchId)}>Quitar</button>
          </div>
          <ConditionTreeEditor
            tree={parseConditions(b.conditions)}
            onChange={(tree) => ops.setBranchConditions(b.branchId, buildConditionsTreeGuiado(tree) as Conditions)}
            label="Si se cumple…"
            contexto={contexto}
          />
          <p className={AYUDA}>
            {b.steps.length} {b.steps.length === 1 ? "acción" : "acciones"} en esta rama. Edítalas seleccionando sus nodos en el lienzo.
          </p>
          <button type="button" className={BOTON} onClick={() => ops.addActionToBranch(b.branchId, "NOTIFY")}>+ Acción en esta rama</button>
        </div>
      ))}
      <button type="button" className={BOTON} onClick={() => ops.addBranch(decision.nodeId)}>+ Añadir rama</button>

      <div className="space-y-2 border-t pt-3" style={{ borderColor: "var(--border-subtle)" }}>
        <label className="flex cursor-pointer items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={decision.else !== undefined}
            onChange={(e) => ops.setElseEnabled(decision.nodeId, e.target.checked)}
          />
          Camino por defecto (si ninguna rama se cumple)
        </label>
        {decision.else !== undefined && (
          <div className="space-y-1.5">
            <p className={AYUDA}>
              {decision.else.length} {decision.else.length === 1 ? "acción" : "acciones"} en el camino por defecto. Edítalas seleccionando sus nodos en el lienzo.
            </p>
            <button type="button" className={BOTON} onClick={() => ops.addActionToElse(decision.nodeId, "NOTIFY")}>+ Acción por defecto</button>
          </div>
        )}
      </div>
    </aside>
  );
}
