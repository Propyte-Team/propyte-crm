"use client";
// Inspector lateral del canvas editable (C.2-i3).
// Renderiza los campos del nodo seleccionado y emite ediciones a través de los ops de useRuleDraft.
// i3: campos amables del catálogo + JSON fallback + re-sync de JsonField.
//
// NOTA DE ADAPTACIÓN:
//   ConditionTreeEditor (condition-tree.tsx) usa { tree: ConditionTree; onChange }
//   donde ConditionTree = { combinator: "all"|"any"; items: CondItem[] } — diferente de
//   RuleDraft.conditions (Conditions = DSL ConditionNode de rebuild-f1.ts).
//   Se usa parseConditions / buildConditionsTree de builder-model para la conversión.

import { useState } from "react";
import type { RuleDraft, Conditions, NodeDraft, DecisionNodeDraft } from "@/lib/journey/rule-draft";
import { isDecisionDraft } from "@/lib/journey/rule-draft";
import { workflowActionTypes, TRIGGER_TYPES } from "@/lib/validations/rebuild-f1";
import { ConditionTreeEditor } from "@/components/config/condition-tree";
import {
  parseConditions,
  buildConditionsTree,
  type ConditionTree,
} from "@/lib/workflows/builder-model";
import {
  fieldDefsFor,
  triggerFieldsFor,
  type FieldDef,
} from "@/lib/journey/node-catalog";
import { DecisionInspector } from "./decision-inspector";

interface Ops {
  addAction: (type: string) => void;
  removeAction: (nodeId: string) => void;
  reorderAction: (nodeId: string, dir: "up" | "down") => void;
  setActionConfig: (nodeId: string, patch: Record<string, unknown>) => void;
  setActionType: (nodeId: string, type: string) => void;
  setActionDelay: (nodeId: string, minutes: number) => void;
  setTrigger: (t: {
    triggerType: string;
    triggerConfig: Record<string, unknown>;
  }) => void;
  setConditions: (c: RuleDraft["conditions"]) => void;
  setMeta: (
    patch: Partial<
      Pick<
        RuleDraft,
        "name" | "description" | "priority" | "cooldownMinutes" | "isActive"
      >
    >
  ) => void;
  // Decision ops (wired in T12)
  addDecision: () => void;
  removeNode: (nodeId: string) => void;
  setDecisionLabel: (nodeId: string, label: string) => void;
  addBranch: (decisionNodeId: string) => void;
  removeBranch: (branchId: string) => void;
  setBranchLabel: (branchId: string, label: string) => void;
  setBranchConditions: (branchId: string, c: RuleDraft["conditions"]) => void;
}

interface RuleInspectorPanelProps {
  draft: RuleDraft;
  selectedId: string | null;
  ops: Ops;
}

// ─── Recursive node finder (tree-aware) ──────────────────────────────────────

function findNode(nodes: NodeDraft[], id: string): NodeDraft | undefined {
  for (const n of nodes) {
    if (n.nodeId === id) return n;
    if (isDecisionDraft(n)) {
      for (const b of n.branches) { const f = findNode(b.steps, id); if (f) return f; }
      if (n.else) { const f = findNode(n.else, id); if (f) return f; }
    }
  }
  return undefined;
}

// ─── Adapter: Conditions (DSL) ↔ ConditionTree (builder-model UI) ────────────

function conditionsToTree(c: Conditions): ConditionTree {
  return parseConditions(c);
}

function treeToConditions(tree: ConditionTree): Conditions {
  return buildConditionsTree(tree) as Conditions;
}

// ─── FriendlyField sub-component ─────────────────────────────────────────────

function FriendlyField({
  def,
  config,
  onChange,
}: {
  def: FieldDef;
  config: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const raw = config[def.configKey];
  if (def.kind === "checkbox") {
    return (
      <label className="label flex items-center gap-2">
        <input
          type="checkbox"
          checked={raw === true}
          onChange={(e) => onChange({ [def.configKey]: e.target.checked })}
        />
        {def.label}
      </label>
    );
  }
  if (def.kind === "select") {
    return (
      <div>
        <label className="label">{def.label}</label>
        <select
          className="form-input"
          value={String(raw ?? "")}
          onChange={(e) => onChange({ [def.configKey]: e.target.value })}
        >
          <option value="">—</option>
          {def.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    );
  }
  if (def.kind === "textarea") {
    return (
      <div>
        <label className="label">{def.label}</label>
        <textarea
          className="form-input"
          rows={3}
          value={String(raw ?? "")}
          placeholder={def.placeholder}
          onChange={(e) => onChange({ [def.configKey]: e.target.value })}
        />
      </div>
    );
  }
  return (
    <div>
      <label className="label">{def.label}</label>
      <input
        className="form-input"
        type={def.kind === "number" ? "number" : "text"}
        value={String(raw ?? "")}
        placeholder={def.placeholder}
        onChange={(e) =>
          onChange({
            [def.configKey]:
              def.kind === "number" ? Number(e.target.value) : e.target.value,
          })
        }
      />
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function RuleInspectorPanel({
  draft,
  selectedId,
  ops,
}: RuleInspectorPanelProps) {
  const selected = selectedId ? findNode(draft.actions, selectedId) : undefined;
  const decision = selected && isDecisionDraft(selected) ? (selected as DecisionNodeDraft) : undefined;
  const action = selected && !isDecisionDraft(selected) ? selected : undefined;

  // ── Trigger node ────────────────────────────────────────────────────────────
  if (selectedId === "trigger") {
    return (
      <aside className="journey-inspector">
        <h3 className="label">Disparador</h3>
        <select
          className="form-input"
          value={draft.triggerType}
          onChange={(e) =>
            ops.setTrigger({
              triggerType: e.target.value,
              triggerConfig: draft.triggerConfig,
            })
          }
        >
          {TRIGGER_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>

        {(() => {
          const defs = triggerFieldsFor(draft.triggerType);
          return defs.length > 0 ? (
            <>
              {defs.map((d) => (
                <FriendlyField
                  key={d.configKey}
                  def={d}
                  config={draft.triggerConfig}
                  onChange={(patch) =>
                    ops.setTrigger({
                      triggerType: draft.triggerType,
                      triggerConfig: { ...draft.triggerConfig, ...patch },
                    })
                  }
                />
              ))}
              <details className="mt-2">
                <summary className="label cursor-pointer">Ver JSON</summary>
                <JsonField
                  key={`trigger:${JSON.stringify(draft.triggerConfig)}`}
                  label="triggerConfig"
                  value={draft.triggerConfig}
                  onChange={(v) =>
                    ops.setTrigger({
                      triggerType: draft.triggerType,
                      triggerConfig: v,
                    })
                  }
                />
              </details>
            </>
          ) : (
            <JsonField
              key={`trigger:${JSON.stringify(draft.triggerConfig)}`}
              label="triggerConfig"
              value={draft.triggerConfig}
              onChange={(v) =>
                ops.setTrigger({
                  triggerType: draft.triggerType,
                  triggerConfig: v,
                })
              }
            />
          );
        })()}
      </aside>
    );
  }

  // ── Condition node ───────────────────────────────────────────────────────────
  if (selectedId === "condition") {
    return (
      <aside className="journey-inspector">
        <ConditionTreeEditor
          tree={conditionsToTree(draft.conditions)}
          onChange={(tree) => ops.setConditions(treeToConditions(tree))}
          label="Condición"
        />
      </aside>
    );
  }

  // ── Decision node ────────────────────────────────────────────────────────────
  if (decision) {
    const decisionOps = {
      setDecisionLabel: ops.setDecisionLabel,
      addBranch: ops.addBranch,
      removeBranch: ops.removeBranch,
      setBranchLabel: ops.setBranchLabel,
      setBranchConditions: ops.setBranchConditions,
    };
    return <DecisionInspector decision={decision} ops={decisionOps} />;
  }

  // ── Action node ──────────────────────────────────────────────────────────────
  if (action) {
    return (
      <aside className="journey-inspector">
        <h3 className="label">Acción</h3>
        <select
          className="form-input"
          value={action.type}
          onChange={(e) => ops.setActionType(action.nodeId, e.target.value)}
        >
          {workflowActionTypes.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>

        {(() => {
          const defs = fieldDefsFor(action.type);
          return defs.length > 0 ? (
            <>
              {defs.map((d) => (
                <FriendlyField
                  key={d.configKey}
                  def={d}
                  config={action.config as Record<string, unknown>}
                  onChange={(patch) => ops.setActionConfig(action.nodeId, patch)}
                />
              ))}
              <details className="mt-2">
                <summary className="label cursor-pointer">Ver JSON</summary>
                <JsonField
                  key={`${action.nodeId}:${JSON.stringify(action.config)}`}
                  label="config"
                  value={action.config as Record<string, unknown>}
                  onChange={(v) => ops.setActionConfig(action.nodeId, v)}
                />
              </details>
            </>
          ) : (
            <JsonField
              key={`${action.nodeId}:${JSON.stringify(action.config)}`}
              label="config"
              value={action.config as Record<string, unknown>}
              onChange={(v) => ops.setActionConfig(action.nodeId, v)}
            />
          );
        })()}

        <label className="label">Retraso (min)</label>
        <input
          className="form-input"
          type="number"
          min={0}
          value={action.delayMinutes ?? 0}
          onChange={(e) =>
            ops.setActionDelay(action.nodeId, Number(e.target.value))
          }
        />

        <div className="inspector-actions">
          <button
            className="btn-secondary"
            onClick={() => ops.reorderAction(action.nodeId, "up")}
          >
            ↑
          </button>
          <button
            className="btn-secondary"
            onClick={() => ops.reorderAction(action.nodeId, "down")}
          >
            ↓
          </button>
          <button
            className="btn-secondary"
            onClick={() => ops.removeNode(action.nodeId)}
          >
            Borrar
          </button>
        </div>
      </aside>
    );
  }

  // ── Rule metadata (no node selected) ────────────────────────────────────────
  return (
    <aside className="journey-inspector">
      <h3 className="label">Regla</h3>
      <input
        className="form-input"
        placeholder="Nombre"
        value={draft.name}
        onChange={(e) => ops.setMeta({ name: e.target.value })}
      />
      <textarea
        className="form-input"
        placeholder="Descripción"
        value={draft.description ?? ""}
        onChange={(e) =>
          ops.setMeta({ description: e.target.value || null })
        }
      />
      <label className="label">Prioridad</label>
      <input
        className="form-input"
        type="number"
        min={1}
        max={1000}
        value={draft.priority}
        onChange={(e) => ops.setMeta({ priority: Number(e.target.value) })}
      />
      <label className="label">
        <input
          type="checkbox"
          checked={draft.isActive}
          onChange={(e) => ops.setMeta({ isActive: e.target.checked })}
        />{" "}
        Activa
      </label>
      <button className="btn-secondary" onClick={() => ops.addAction("NOTIFY")}>
        + Añadir acción
      </button>
      <button type="button" className="btn-secondary" onClick={() => ops.addDecision()}>
        + Añadir decisión
      </button>
    </aside>
  );
}

// ─── JsonField helper ─────────────────────────────────────────────────────────
// Mantiene texto local para permitir JSON parcialmente inválido mientras el usuario escribe.
// Re-mounts via key when external value changes (i3 re-sync fix).

function JsonField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
}) {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  const [bad, setBad] = useState(false);

  return (
    <div>
      <label className="label">{label}</label>
      <textarea
        className="form-input"
        rows={4}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          try {
            onChange(JSON.parse(e.target.value) as Record<string, unknown>);
            setBad(false);
          } catch {
            setBad(true);
          }
        }}
      />
      {bad && (
        <span
          style={{ color: "var(--danger, #b91c1c)", fontSize: 12 }}
        >
          JSON inválido
        </span>
      )}
    </div>
  );
}
