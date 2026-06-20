// Builder visual de reglas de automatización (Fase 4, T4.2) — basado en formulario.
// Construye trigger + condiciones DSL (all/any · field/op/value) + acciones, sin JSON crudo.
"use client";

import { useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import {
  buildTriggerConfig, buildConditions, nodeToRows, parseTriggerValue,
  FIELD_SUGGESTIONS, DEAL_STAGES, type CondLeaf,
} from "@/lib/workflows/builder-model";

const TRIGGER_TYPES = [
  { value: "EVENT", label: "Evento del sistema" },
  { value: "STAGE_CHANGE", label: "Cambio de etapa" },
  { value: "SCORE_THRESHOLD", label: "Umbral de score" },
  { value: "INACTIVITY", label: "Inactividad" },
  { value: "SLA_BREACH", label: "Incumplimiento de SLA" },
  { value: "TIME", label: "Programado (tiempo)" },
  { value: "BEHAVIORAL", label: "Comportamiento web" },
];

const OPS = [
  { value: "eq", label: "= igual" },
  { value: "neq", label: "≠ distinto" },
  { value: "gt", label: "> mayor" },
  { value: "gte", label: "≥ mayor o igual" },
  { value: "lt", label: "< menor" },
  { value: "lte", label: "≤ menor o igual" },
  { value: "in", label: "en lista" },
  { value: "nin", label: "no en lista" },
  { value: "contains", label: "contiene" },
  { value: "exists", label: "existe" },
  { value: "changed_to", label: "cambió a" },
];

const ACTION_TYPES = [
  "CREATE_TASK", "SEND_WHATSAPP", "SEND_EMAIL", "MAKE_CALL", "ASSIGN", "REASSIGN",
  "NOTIFY", "UPDATE_FIELD", "ADD_TAG", "CHANGE_STAGE", "ENROLL_PLAN", "ESCALATE",
  "AI_DRAFT", "AI_REPLY", "AI_CALL_SUMMARY", "WEBHOOK",
];

// Campos de config por tipo de acción (para no escribir JSON crudo).
const ACTION_FIELDS: Record<string, { key: string; label: string; type?: string }[]> = {
  CREATE_TASK: [{ key: "subject", label: "Asunto" }, { key: "dueInHours", label: "Vence en (horas)", type: "number" }],
  SEND_WHATSAPP: [{ key: "templateName", label: "Plantilla" }, { key: "body", label: "Mensaje" }],
  SEND_EMAIL: [{ key: "subject", label: "Asunto" }, { key: "body", label: "Cuerpo" }],
  NOTIFY: [{ key: "message", label: "Mensaje" }],
  ADD_TAG: [{ key: "tag", label: "Etiqueta" }],
  CHANGE_STAGE: [{ key: "stage", label: "Etapa destino" }],
  UPDATE_FIELD: [{ key: "field", label: "Campo" }, { key: "value", label: "Valor" }],
  ASSIGN: [{ key: "strategy", label: "Estrategia (round_robin/territory)" }],
  REASSIGN: [{ key: "strategy", label: "Estrategia" }],
  ESCALATE: [{ key: "reason", label: "Motivo" }],
  ENROLL_PLAN: [{ key: "planId", label: "ID del plan" }],
  AI_DRAFT: [{ key: "instruction", label: "Instrucción" }],
  AI_REPLY: [{ key: "instruction", label: "Instrucción" }],
  AI_CALL_SUMMARY: [{ key: "instruction", label: "Instrucción" }],
  WEBHOOK: [{ key: "url", label: "URL" }],
  MAKE_CALL: [{ key: "note", label: "Nota" }],
};

interface ActionRow { type: string; config: Record<string, string> }

interface Props {
  rule?: any;
  onSaved: () => void;
  onCancel: () => void;
}

export function WorkflowBuilder({ rule, onSaved, onCancel }: Props) {
  const isEdit = !!rule;
  const [name, setName] = useState(rule?.name ?? "");
  const [description, setDescription] = useState(rule?.description ?? "");
  const [triggerType, setTriggerType] = useState(rule?.triggerType ?? "EVENT");
  const [triggerValue, setTriggerValue] = useState<string>(parseTriggerValue(rule));
  const initCond = nodeToRows(rule?.conditions);
  const [combinator, setCombinator] = useState<"all" | "any">(initCond.combinator);
  const [conds, setConds] = useState<CondLeaf[]>(initCond.rows);
  const [actions, setActions] = useState<ActionRow[]>(
    Array.isArray(rule?.actions) && rule.actions.length
      ? rule.actions.map((a: any) => ({ type: a.type, config: a.config ?? {} }))
      : [{ type: "CREATE_TASK", config: {} }]
  );
  const [priority, setPriority] = useState(String(rule?.priority ?? 100));
  const [cooldown, setCooldown] = useState(String(rule?.cooldownMinutes ?? ""));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(activate: boolean) {
    setError(null);
    if (!name || name.length < 3) { setError("El nombre debe tener al menos 3 caracteres."); return; }
    if (actions.length === 0) { setError("Agrega al menos una acción."); return; }
    setSaving(true);
    const payload = {
      ...(isEdit ? { id: rule.id } : {}),
      name, description: description || null,
      triggerType, triggerConfig: buildTriggerConfig(triggerType, triggerValue),
      conditions: buildConditions(combinator, conds),
      actions: actions.map((a) => ({ type: a.type, config: a.config })),
      priority: Number(priority) || 100,
      cooldownMinutes: cooldown ? Number(cooldown) : null,
      isActive: activate,
    };
    const res = await fetch("/api/admin/automation/rules", {
      method: isEdit ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    if (res.ok) onSaved();
    else {
      const d = await res.json().catch(() => ({}));
      setError(typeof d.error === "string" ? d.error : "No se pudo guardar la regla");
    }
  }

  const showTriggerValue = ["EVENT", "STAGE_CHANGE", "SCORE_THRESHOLD", "INACTIVITY"].includes(triggerType);
  const triggerValuePlaceholder =
    triggerType === "EVENT" ? "ej. lead.captured, deal.stage_changed"
    : triggerType === "STAGE_CHANGE" ? "etapa (ej. RESERVED)"
    : triggerType === "SCORE_THRESHOLD" ? "score mínimo (ej. 70)"
    : triggerType === "INACTIVITY" ? "horas sin actividad (ej. 48)" : "";

  return (
    <div className="space-y-5">
      {error && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {/* Identidad */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="Nombre">
          <input className="form-input text-[13px]" value={name} onChange={(e) => setName(e.target.value)} placeholder="ej. SLA primer toque" />
        </Field>
        <Field label="Prioridad (menor = primero)">
          <input className="form-input text-[13px]" type="number" value={priority} onChange={(e) => setPriority(e.target.value)} />
        </Field>
      </div>
      <Field label="Descripción">
        <input className="form-input text-[13px]" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Qué hace esta regla" />
      </Field>

      {/* Trigger */}
      <div className="crm-card !p-4 space-y-3">
        <h3 className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>Disparador</h3>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <select className="form-input text-[13px]" value={triggerType} onChange={(e) => { setTriggerType(e.target.value); setTriggerValue(""); }}>
            {TRIGGER_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          {showTriggerValue && (
            triggerType === "STAGE_CHANGE" ? (
              <select className="form-input text-[13px]" value={triggerValue} onChange={(e) => setTriggerValue(e.target.value)}>
                <option value="">Selecciona etapa…</option>
                {DEAL_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            ) : (
              <input className="form-input text-[13px]" value={triggerValue} onChange={(e) => setTriggerValue(e.target.value)} placeholder={triggerValuePlaceholder} />
            )
          )}
        </div>
      </div>

      {/* Condiciones */}
      <div className="crm-card !p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>Condiciones</h3>
          <div className="flex items-center gap-2 text-[12px]">
            <span style={{ color: "var(--text-tertiary)" }}>Cumplir</span>
            <select className="form-input !w-auto text-[12px]" value={combinator} onChange={(e) => setCombinator(e.target.value as "all" | "any")}>
              <option value="all">todas</option>
              <option value="any">cualquiera</option>
            </select>
          </div>
        </div>
        <datalist id="field-suggestions">{FIELD_SUGGESTIONS.map((f) => <option key={f} value={f} />)}</datalist>
        {conds.map((c, i) => (
          <div key={i} className="flex items-center gap-2">
            <input list="field-suggestions" className="form-input text-[13px]" placeholder="campo (ej. contact.score)" value={c.field}
              onChange={(e) => setConds(conds.map((x, j) => j === i ? { ...x, field: e.target.value } : x))} />
            <select className="form-input !w-auto text-[13px]" value={c.op}
              onChange={(e) => setConds(conds.map((x, j) => j === i ? { ...x, op: e.target.value } : x))}>
              {OPS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            {c.op !== "exists" && (
              <input className="form-input text-[13px]" placeholder={c.op === "in" || c.op === "nin" ? "a,b,c" : "valor"} value={c.value}
                onChange={(e) => setConds(conds.map((x, j) => j === i ? { ...x, value: e.target.value } : x))} />
            )}
            <button type="button" onClick={() => setConds(conds.filter((_, j) => j !== i))} className="shrink-0 text-[color:var(--text-tertiary)] hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
        <button type="button" onClick={() => setConds([...conds, { field: "", op: "eq", value: "" }])} className="btn-secondary text-[12px]">
          <Plus className="h-3.5 w-3.5" /> Condición
        </button>
        {conds.length === 0 && <p className="text-[12px]" style={{ color: "var(--text-tertiary)" }}>Sin condiciones = la regla aplica siempre que dispare el trigger.</p>}
      </div>

      {/* Acciones */}
      <div className="crm-card !p-4 space-y-3">
        <h3 className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>Acciones</h3>
        {actions.map((a, i) => (
          <div key={i} className="rounded-md border p-3" style={{ borderColor: "var(--border-subtle)" }}>
            <div className="flex items-center justify-between gap-2">
              <select className="form-input text-[13px]" value={a.type}
                onChange={(e) => setActions(actions.map((x, j) => j === i ? { type: e.target.value, config: {} } : x))}>
                {ACTION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <button type="button" onClick={() => setActions(actions.filter((_, j) => j !== i))} className="shrink-0 text-[color:var(--text-tertiary)] hover:text-red-600"><X className="h-4 w-4" /></button>
            </div>
            <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
              {(ACTION_FIELDS[a.type] ?? []).map((f) => (
                f.key === "stage" ? (
                  <select key={f.key} className="form-input text-[13px]" value={a.config[f.key] ?? ""}
                    onChange={(e) => setActions(actions.map((x, j) => j === i ? { ...x, config: { ...x.config, [f.key]: e.target.value } } : x))}>
                    <option value="">{f.label}…</option>
                    {DEAL_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                ) : (
                  <input key={f.key} className="form-input text-[13px]" type={f.type ?? "text"} placeholder={f.label} value={a.config[f.key] ?? ""}
                    onChange={(e) => setActions(actions.map((x, j) => j === i ? { ...x, config: { ...x.config, [f.key]: e.target.value } } : x))} />
                )
              ))}
            </div>
          </div>
        ))}
        <button type="button" onClick={() => setActions([...actions, { type: "CREATE_TASK", config: {} }])} className="btn-secondary text-[12px]">
          <Plus className="h-3.5 w-3.5" /> Acción
        </button>
      </div>

      {/* Cooldown */}
      <Field label="Cooldown (minutos, opcional — evita re-disparos)">
        <input className="form-input max-w-[200px] text-[13px]" type="number" value={cooldown} onChange={(e) => setCooldown(e.target.value)} placeholder="ej. 1440" />
      </Field>

      {/* Acciones del form */}
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" className="btn-secondary text-[13px]" onClick={onCancel} disabled={saving}>Cancelar</button>
        <button type="button" className="btn-secondary text-[13px]" onClick={() => save(false)} disabled={saving}>Guardar pausada</button>
        <button type="button" className="btn-primary text-[13px]" onClick={() => save(true)} disabled={saving}>
          {saving ? "Guardando…" : "Guardar y activar"}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>{label}</label>
      {children}
    </div>
  );
}
