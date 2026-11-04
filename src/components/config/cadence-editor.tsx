// Editor visual de cadencias (ActionPlan + pasos) para /configuracion.
// Reusa ConditionTreeEditor para las condiciones de salida (exitConditions).
"use client";

import { useState } from "react";
import { ActionCard, ActionPicker } from "./action-card";
import { useFuentes } from "./use-fuentes";
import {
  abiertaTrasMover, abiertaTrasQuitar, minutosAcumulados, pasoNuevo, primerProblemaDePasos, type StepRow,
} from "./cadence-editor-model";
import { describeStep } from "@/lib/workflows/action-catalog";
import { ConditionTreeEditor } from "./condition-tree";
import { parseConditions, type ConditionTree } from "@/lib/workflows/builder-model";
import { buildConditionsTreeGuiado } from "./condition-tree-model";
import { AUTONOMY_LABELS } from "@/lib/labels";
import { NOMBRES_DE_CAMPO, erroresPorCampo, mensajeDeError } from "@/lib/api-errors";

interface PlanData {
  id?: string;
  name: string;
  description: string;
  exitConditions: unknown;
  steps: StepRow[];
}

// Orden fijo L0 → L2 (opciones() ordenaría alfabéticamente); textos del diccionario único.
const AUTONOMY = (["L0", "L1", "L2"] as const).map((value) => ({
  value,
  label: AUTONOMY_LABELS[value] ?? value,
}));

// ---------------------------------------------------------------------------
// Helpers compartidos por las pantallas de Automatización (reglas, cadencias, SLA).
// Viven aquí porque E1 limita los archivos editables; puros salvo DelayInput.
// ---------------------------------------------------------------------------

/** Minutos → texto de negocio: 0 "Inmediato", 15 "15 min", 180 "3 h", 2880 "2 días", 90 "1 h 30 min". */
export function formatMinutes(min: number): string {
  const total = Math.round(Number(min));
  if (!Number.isFinite(total) || total <= 0) return "Inmediato";
  if (total < 60) return `${total} min`;
  if (total < 1440) {
    const h = Math.floor(total / 60);
    const m = total % 60;
    return m === 0 ? `${h} h` : `${h} h ${m} min`;
  }
  const d = Math.floor(total / 1440);
  const rest = total % 1440;
  const dias = `${d} ${d === 1 ? "día" : "días"}`;
  if (rest === 0) return dias;
  const h = Math.floor(rest / 60);
  const m = rest % 60;
  const resto = [h > 0 ? `${h} h` : "", m > 0 ? `${m} min` : ""].filter(Boolean).join(" ");
  return `${dias} ${resto}`;
}

/** Etiquetas de campos del payload de automatización que api-errors no conoce. */
export const CAMPOS_AUTOMATIZACION: Record<string, string> = {
  ...NOMBRES_DE_CAMPO,
  triggerType: "Disparador",
  triggerConfig: "Valor del disparador",
  actions: "Acciones",
  steps: "Pasos",
  exitConditions: "Condiciones de salida",
  cooldownMinutes: "Plazo para no repetir",
  firstTouchMinutes: "Contactar en",
  retryMinutes: "Recordar cada",
  orphanHours: "Reasignar a las",
  businessHours: "Horario laboral",
  isDefault: "Política general",
  isActive: "Activa",
};

/** Mensaje legible de un error de API con nombres de campo en español de negocio. */
export function mensajeAutomatizacion(data: unknown, fallback = "No se pudo guardar"): string {
  const fe = erroresPorCampo(data);
  const campos = Object.keys(fe);
  if (campos.length === 0) return mensajeDeError(data, fallback);
  return campos.map((c) => `${CAMPOS_AUTOMATIZACION[c] ?? c}: ${fe[c]}`).join(" · ");
}

type Unidad = "min" | "h" | "d";
const FACTOR: Record<Unidad, number> = { min: 1, h: 60, d: 1440 };
const UNIDAD_LABEL: Record<Unidad, string> = { min: "minutos", h: "horas", d: "días" };

function unidadAuto(min: number): Unidad {
  if (min > 0 && min % 1440 === 0) return "d";
  if (min > 0 && min % 60 === 0) return "h";
  return "min";
}

/**
 * Entrada de plazo con unidad (minutos / horas / días). El valor SIEMPRE viaja en
 * minutos (string; "" = sin valor). Muestra el equivalente legible y presets opcionales.
 */
export function DelayInput({
  value, onChange, presets, emptyText = "Inmediato", width = 90,
}: {
  value: string;
  onChange: (minutes: string) => void;
  presets?: { label: string; minutes: number }[];
  emptyText?: string;
  width?: number;
}) {
  const [picked, setPicked] = useState<Unidad | null>(null);
  const minutes = value === "" ? 0 : Number(value);
  const ok = Number.isFinite(minutes);
  const unidad = picked ?? unidadAuto(ok ? minutes : 0);
  const shown = value === "" || !ok ? "" : String(Math.round((minutes / FACTOR[unidad]) * 100) / 100);
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          type="number"
          min={0}
          step="any"
          value={shown}
          onChange={(e) => onChange(e.target.value === "" ? "" : String(Math.round(Number(e.target.value) * FACTOR[unidad])))}
          className="form-input !py-0.5 text-[13px] num"
          style={{ width }}
        />
        <select
          value={unidad}
          onChange={(e) => setPicked(e.target.value as Unidad)}
          className="form-input !w-auto !py-0.5 text-[13px]"
          aria-label="Unidad de tiempo"
        >
          {(Object.keys(FACTOR) as Unidad[]).map((u) => <option key={u} value={u}>{UNIDAD_LABEL[u]}</option>)}
        </select>
        {presets?.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => { setPicked(null); onChange(p.minutes > 0 ? String(p.minutes) : ""); }}
            className="rounded border px-1.5 py-0.5 text-[11px] hover:bg-black/5"
            style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}
          >
            {p.label}
          </button>
        ))}
      </div>
      <p className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
        {value === "" || !ok || minutes <= 0 ? emptyText : `= ${formatMinutes(minutes)}`}
      </p>
    </div>
  );
}

function treeToConditions(tree: ConditionTree): unknown {
  if (tree.items.length === 0) return {};
  return buildConditionsTreeGuiado(tree);
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
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});
  const { fuentes, listas } = useFuentes();
  const [abierta, setAbierta] = useState<number | null>(null);
  const acumulados = minutosAcumulados(plan.steps);

  function addStep(actionType: string) {
    setPlan((p) => ({ ...p, steps: [...p.steps, pasoNuevo(actionType)] }));
    setAbierta(plan.steps.length);
  }

  function updateStep(i: number, patch: Partial<StepRow>) {
    setPlan((p) => ({
      ...p,
      steps: p.steps.map((s, idx) => (idx === i ? { ...s, ...patch } : s)),
    }));
  }

  function removeStep(i: number) {
    setPlan((p) => ({ ...p, steps: p.steps.filter((_, idx) => idx !== i) }));
    setAbierta((a) => abiertaTrasQuitar(a, i));
  }

  function move(i: number, dir: -1 | 1) {
    setPlan((p) => {
      const steps = [...p.steps];
      const j = i + dir;
      if (j < 0 || j >= steps.length) return p;
      [steps[i], steps[j]] = [steps[j], steps[i]];
      return { ...p, steps };
    });
    setAbierta((a) => abiertaTrasMover(a, i, i + dir));
  }

  async function save() {
    setErr(null);
    setFieldErrs({});
    const problema = primerProblemaDePasos(plan.steps, fuentes);
    if (problema) {
      setErr(problema);
      return;
    }
    setBusy(true);
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
      setFieldErrs(erroresPorCampo(d));
      setErr(mensajeAutomatizacion(d, "No se pudo guardar la cadencia"));
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
          {fieldErrs.name && <p className="text-[11px] text-red-600">{fieldErrs.name}</p>}
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
          <div key={i} className="space-y-1.5 rounded-md border p-2.5" style={{ borderColor: "var(--border-subtle)" }}>
            <p className="text-[12px] font-medium" style={{ color: "var(--text-secondary)" }}>
              {describeStep(s, fuentes, { acumuladoMinutos: acumulados[i] })}
            </p>
            <ActionCard
              action={{ type: s.actionType, config: s.config }}
              index={i}
              total={plan.steps.length}
              fuentes={fuentes}
              listas={listas}
              abierta={abierta === i}
              onToggle={() => setAbierta(abierta === i ? null : i)}
              onChange={(next) => updateStep(i, { actionType: next.type, config: next.config })}
              onMove={(dir) => move(i, dir)}
              onRemove={() => removeStep(i)}
              mostrarRetraso={false}
            />
            <div className="flex flex-wrap items-start gap-x-4 gap-y-2 text-[12px]" style={{ color: "var(--text-secondary)" }}>
              <div className="flex items-start gap-1.5">
                <span className="pt-1">{i === 0 ? "Empezar tras" : "Esperar"}</span>
                <DelayInput
                  value={String(s.delayMinutes)}
                  onChange={(v) => updateStep(i, { delayMinutes: v === "" ? 0 : Number(v) })}
                  emptyText={i === 0 ? "Inmediato (al entrar a la cadencia)" : "Sin espera"}
                />
              </div>
              <select
                value={s.autonomyLevel}
                onChange={(e) => updateStep(i, { autonomyLevel: e.target.value })}
                className="form-input !w-auto !py-0.5 text-[13px]"
                aria-label="Nivel de autonomía"
                title="Solo sugiere: propone al asesor · Pide aprobación: espera un OK · Automático: se ejecuta solo"
              >
                {AUTONOMY.map((a) => (
                  <option key={a.value} value={a.value}>{a.label}</option>
                ))}
              </select>
            </div>
          </div>
        ))}
        <ActionPicker onPick={(a) => addStep(a.type)} label="Agregar paso" />
      </div>

      {/* Condiciones de salida */}
      <ConditionTreeEditor
        tree={exitTree}
        onChange={setExitTree}
        label="Condiciones de salida"
        contexto="contact"
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
