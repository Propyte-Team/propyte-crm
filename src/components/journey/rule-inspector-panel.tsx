"use client";
// Inspector lateral del canvas editable (C.2-i2).
// Renderiza los campos del nodo seleccionado y emite ediciones a través de los ops de useRuleDraft.
//
// NOTA DE ADAPTACIÓN:
//   ConditionTreeEditor (condition-tree.tsx) usa { tree: ConditionTree; onChange }
//   donde ConditionTree = { combinator: "all"|"any"; items: CondItem[] } — diferente de
//   RuleDraft.conditions (Conditions = DSL ConditionNode de rebuild-f1.ts).
//   Se usa parseConditions / buildConditionsTree de builder-model para la conversión.

import { useState } from "react";
import type { RuleDraft, Conditions } from "@/lib/journey/rule-draft";
import { workflowActionTypes } from "@/lib/validations/rebuild-f1";
import { LIFECYCLE_ORDER, LIFECYCLE_LABELS } from "@/lib/constants";
import { ConditionTreeEditor } from "@/components/config/condition-tree";
import {
  parseConditions,
  buildConditionsTree,
  type ConditionTree,
} from "@/lib/workflows/builder-model";

const TRIGGER_TYPES = [
  "EVENT",
  "TIME",
  "BEHAVIORAL",
  "INACTIVITY",
  "STAGE_CHANGE",
  "SLA_BREACH",
  "SCORE_THRESHOLD",
];

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
}

interface RuleInspectorPanelProps {
  draft: RuleDraft;
  selectedId: string | null;
  ops: Ops;
}

// ─── Adapter: Conditions (DSL) ↔ ConditionTree (builder-model UI) ────────────

function conditionsToTree(c: Conditions): ConditionTree {
  return parseConditions(c);
}

function treeToConditions(tree: ConditionTree): Conditions {
  return buildConditionsTree(tree) as Conditions;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function RuleInspectorPanel({
  draft,
  selectedId,
  ops,
}: RuleInspectorPanelProps) {
  const action = selectedId?.startsWith("a")
    ? draft.actions.find((a) => a.nodeId === selectedId)
    : undefined;

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
        <JsonField
          key="trigger-config"
          label="triggerConfig"
          value={draft.triggerConfig}
          onChange={(v) =>
            ops.setTrigger({
              triggerType: draft.triggerType,
              triggerConfig: v,
            })
          }
        />
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

  // ── Action node ──────────────────────────────────────────────────────────────
  if (action) {
    const config = action.config as Record<string, unknown>;
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

        {action.type === "CHANGE_STAGE" && (
          <select
            className="form-input"
            value={String(config.toStage ?? "")}
            onChange={(e) =>
              ops.setActionConfig(action.nodeId, { toStage: e.target.value })
            }
          >
            <option value="">— etapa —</option>
            {LIFECYCLE_ORDER.map((s) => (
              <option key={s} value={s}>
                {LIFECYCLE_LABELS[s] ?? s}
              </option>
            ))}
          </select>
        )}

        <JsonField
          key={action.nodeId}
          label="config"
          value={action.config}
          onChange={(v) => ops.setActionConfig(action.nodeId, v)}
        />

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
            onClick={() => ops.removeAction(action.nodeId)}
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
    </aside>
  );
}

// ─── JsonField helper ─────────────────────────────────────────────────────────
// Mantiene texto local para permitir JSON parcialmente inválido mientras el usuario escribe.

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
