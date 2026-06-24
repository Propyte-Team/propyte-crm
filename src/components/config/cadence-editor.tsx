// Editor visual de cadencias (ActionPlan + pasos) para /configuracion.
// Reusa ConditionTreeEditor para las condiciones de salida (exitConditions).
"use client";

import { useState } from "react";
import { Plus, Trash2, ChevronUp, ChevronDown } from "lucide-react";
import { ConditionTreeEditor } from "./condition-tree";
import { buildConditionsTree, parseConditions, type ConditionTree } from "@/lib/workflows/builder-model";

interface StepRow {
  actionType: string;
  delayMinutes: number;
  config: Record<string, string>;
  autonomyLevel: string;
}

interface PlanData {
  id?: string;
  name: string;
  description: string;
  exitConditions: unknown;
  steps: StepRow[];
}

const ACTION_OPTIONS = [
  "SEND_WHATSAPP", "SEND_EMAIL", "CREATE_TASK", "NOTIFY", "ADD_TAG",
  "UPDATE_FIELD", "ASSIGN", "SET_LIFECYCLE", "AI_DRAFT", "WEBHOOK",
];

const AUTONOMY = [
  { value: "L0", label: "L0 — Automático" },
  { value: "L1", label: "L1 — Propuesta" },
  { value: "L2", label: "L2 — Requiere OK" },
];

function treeToConditions(tree: ConditionTree): unknown {
  if (tree.items.length === 0) return {};
  return buildConditionsTree(tree);
}

function conditionsToTree(exitConditions: unknown): ConditionTree {
  return parseConditions(exitConditions);
}

export function CadenceEditor({
  initial,
  onSaved,
  onCancel,
}: {
  initial?: PlanData;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [plan, setPlan] = useState<PlanData>(
    initial ?? { name: "", description: "", exitConditions: {}, steps: [] }
  );
  const [exitTree, setExitTree] = useState<ConditionTree>(
    conditionsToTree(initial?.exitConditions)
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function addStep() {
    setPlan((p) => ({
      ...p,
      steps: [
        ...p.steps,
        { actionType: "SEND_WHATSAPP", delayMinutes: 0, config: {}, autonomyLevel: "L0" },
      ],
    }));
  }

  function updateStep(i: number, patch: Partial<StepRow>) {
    setPlan((p) => ({
      ...p,
      steps: p.steps.map((s, idx) => (idx === i ? { ...s, ...patch } : s)),
    }));
  }

  function removeStep(i: number) {
    setPlan((p) => ({ ...p, steps: p.steps.filter((_, idx) => idx !== i) }));
  }

  function move(i: number, dir: -1 | 1) {
    setPlan((p) => {
      const steps = [...p.steps];
      const j = i + dir;
      if (j < 0 || j >= steps.length) return p;
      [steps[i], steps[j]] = [steps[j], steps[i]];
      return { ...p, steps };
    });
  }

  async function save() {
    setBusy(true);
    setErr(null);
    const url = plan.id
      ? `/api/admin/automation/plans/${plan.id}`
      : "/api/admin/automation/plans";
    const res = await fetch(url, {
      method: plan.id ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: plan.name,
        description: plan.description || undefined,
        exitConditions: treeToConditions(exitTree),
        steps: plan.steps,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setErr(
        typeof d.error === "string"
          ? d.error
          : d.error?.formErrors?.join(", ") ?? "Error al guardar"
      );
      return;
    }
    onSaved();
  }

  return (
    <div className="space-y-4 rounded-lg border p-5" style={{ borderColor: "var(--border-subtle)", background: "var(--bg-card)" }}>
      {/* Identidad */}
      <div className="space-y-3">
        <div className="space-y-1">
          <label className="text-[11px] uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>
            Nombre de la cadencia
          </label>
          <input
            value={plan.name}
            onChange={(e) => setPlan({ ...plan, name: e.target.value })}
            placeholder="ej. Bienvenida nuevo lead"
            className="form-input text-[13px] font-medium"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>
            Descripción (opcional)
          </label>
          <textarea
            value={plan.description}
            onChange={(e) => setPlan({ ...plan, description: e.target.value })}
            placeholder="Qué hace esta cadencia"
            rows={2}
            className="form-input text-[13px]"
          />
        </div>
      </div>

      {/* Pasos */}
      <div className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>
          Pasos ({plan.steps.length})
        </p>
        {plan.steps.length === 0 && (
          <p className="text-[12px]" style={{ color: "var(--text-tertiary)" }}>
            Sin pasos todavía. Agrega el primero abajo.
          </p>
        )}
        {plan.steps.map((s, i) => (
          <div
            key={i}
            className="flex flex-wrap items-center gap-2 rounded-md border p-2.5 text-[13px]"
            style={{ borderColor: "var(--border-subtle)" }}
          >
            <span
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-medium"
              style={{ background: "var(--bg-badge-neutral)", color: "var(--text-secondary)" }}
            >
              {i + 1}
            </span>

            <label className="flex items-center gap-1 text-[12px]" style={{ color: "var(--text-secondary)" }}>
              Esperar
              <input
                type="number"
                min={0}
                value={s.delayMinutes}
                onChange={(e) => updateStep(i, { delayMinutes: Number(e.target.value) })}
                className="form-input !w-20 !py-0.5 text-[13px] num"
              />
              min
            </label>

            <select
              value={s.actionType}
              onChange={(e) => updateStep(i, { actionType: e.target.value })}
              className="form-input !py-0.5 text-[13px]"
            >
              {ACTION_OPTIONS.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>

            <select
              value={s.autonomyLevel}
              onChange={(e) => updateStep(i, { autonomyLevel: e.target.value })}
              className="form-input !w-auto !py-0.5 text-[13px]"
            >
              {AUTONOMY.map((a) => (
                <option key={a.value} value={a.value}>{a.label}</option>
              ))}
            </select>

            <div className="ml-auto flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => move(i, -1)}
                disabled={i === 0}
                className="rounded p-0.5 text-[color:var(--text-tertiary)] hover:text-[color:var(--text-primary)] disabled:opacity-30"
                title="Subir paso"
              >
                <ChevronUp className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => move(i, 1)}
                disabled={i === plan.steps.length - 1}
                className="rounded p-0.5 text-[color:var(--text-tertiary)] hover:text-[color:var(--text-primary)] disabled:opacity-30"
                title="Bajar paso"
              >
                <ChevronDown className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => removeStep(i)}
                className="rounded p-0.5 text-[color:var(--text-tertiary)] hover:text-red-600"
                title="Eliminar paso"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={addStep}
          className="btn-secondary text-[12px]"
        >
          <Plus className="h-3.5 w-3.5" /> Agregar paso
        </button>
      </div>

      {/* Condiciones de salida */}
      <ConditionTreeEditor
        tree={exitTree}
        onChange={setExitTree}
        label="Condiciones de salida"
        emptyText="Sin condiciones = el contacto recorre todos los pasos sin salida anticipada."
      />

      {/* Error + acciones */}
      {err && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">{err}</p>
      )}
      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="btn-secondary text-[13px]"
          disabled={busy}
        >
          Cancelar
        </button>
        <button
          type="button"
          disabled={busy || !plan.name.trim()}
          onClick={save}
          className="btn-primary text-[13px]"
        >
          {busy ? "Guardando…" : plan.id ? "Actualizar cadencia" : "Crear cadencia"}
        </button>
      </div>
    </div>
  );
}
