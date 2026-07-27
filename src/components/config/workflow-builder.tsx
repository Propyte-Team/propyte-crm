// Builder visual de reglas de automatización (Fase 4, T4.2) — basado en formulario.
// Construye trigger + condiciones DSL (all/any · field/op/value) + acciones, sin JSON crudo.
"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import {
  buildTriggerConfig, buildConditionsTree, parseConditions, parseTriggerValue, hasDecisionNode,
  DEAL_STAGES, LIFECYCLE_STAGES,
  type ConditionTree, type ActionRow,
} from "@/lib/workflows/builder-model";
import { LIFECYCLE_LABELS } from "@/lib/constants";
import { RULE_TEMPLATES } from "@/lib/workflows/builder-templates";
import { ConditionTreeEditor } from "./condition-tree";
import {
  NODE_CATALOG, TRIGGER_CATALOG, coerceFieldConfig, labelFor, type FieldDef,
} from "@/lib/journey/node-catalog";

// Catálogo único de acciones/disparadores (C.2-i3, sub-task 2). Antes este archivo
// mantenía sus PROPIOS `TRIGGER_TYPES`/`ACTION_TYPES`/`ACTION_FIELDS` duplicados, que
// se desincronizaban del catálogo compartido (usado por el canvas de Journey) cada vez
// que alguien agregaba una acción/disparador en un solo lado. Ahora todo se DERIVA de
// node-catalog.ts (+ TRIGGER_TYPES de rebuild-f1 vía TRIGGER_CATALOG) — una sola fuente.
export const BUILDER_TRIGGER_TYPES: { value: string; label: string }[] = TRIGGER_CATALOG.map((m) => ({
  value: m.type,
  label: m.label,
}));

export const BUILDER_ACTION_TYPES: string[] = NODE_CATALOG.map((m) => m.type);

export const BUILDER_ACTION_FIELDS: Record<string, FieldDef[]> = Object.fromEntries(
  NODE_CATALOG.map((m) => [m.type, m.fields ?? []]),
);

// Guard anti data-loss (sub-task 3): una regla armada en el canvas de Journey puede
// traer nodos `kind:"decision"` (ramas) que este form plano no sabe representar ni
// reconstruir. Si el form la "guarda" igual, aplana `actions` y la estructura de
// ramas se pierde para siempre. `shouldGuardRule` es la única fuente de esa decisión
// — el componente y cualquier prueba la consultan igual, sin lógica duplicada.
export function shouldGuardRule(rule: { actions?: unknown } | null | undefined): boolean {
  return hasDecisionNode(rule?.actions);
}

export const DECISION_GUARD_MESSAGE =
  "Esta regla usa ramas de decisión; edítala en el canvas de Journey para no perder su estructura.";

interface Props {
  rule?: any;
  onSaved: () => void;
  onCancel: () => void;
}


export function WorkflowBuilder({ rule, onSaved, onCancel }: Props) {
  const isEdit = !!rule;
  // Guard anti data-loss (sub-task 3): si la regla trae nodos de decisión, este form
  // plano NUNCA los aplana ni los guarda — ver shouldGuardRule/DECISION_GUARD_MESSAGE arriba.
  const guarded = shouldGuardRule(rule);
  const [name, setName] = useState(rule?.name ?? "");
  const [description, setDescription] = useState(rule?.description ?? "");
  const [triggerType, setTriggerType] = useState(rule?.triggerType ?? "EVENT");
  const [triggerValue, setTriggerValue] = useState<string>(parseTriggerValue(rule));
  const [tree, setTree] = useState<ConditionTree>(parseConditions(rule?.conditions));
  const [actions, setActions] = useState<ActionRow[]>(
    !guarded && Array.isArray(rule?.actions) && rule.actions.length
      ? rule.actions.map((a: any) => ({ type: a.type, config: a.config ?? {}, delayMinutes: a.delayMinutes != null ? String(a.delayMinutes) : "" }))
      : [{ type: "CREATE_TASK", config: {} }]
  );
  const [priority, setPriority] = useState(String(rule?.priority ?? 100));
  const [cooldown, setCooldown] = useState(String(rule?.cooldownMinutes ?? ""));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);


  function applyTemplate(key: string) {
    const t = RULE_TEMPLATES.find((x) => x.key === key);
    if (!t) return;
    setName(t.rule.name);
    setDescription(t.rule.description);
    setTriggerType(t.rule.triggerType);
    setTriggerValue(String(t.rule.triggerConfig.eventType ?? ""));
    setTree(parseConditions(t.rule.conditions));
    setActions(t.rule.actions.map((a) => ({ type: a.type, config: a.config as Record<string, string>, delayMinutes: a.delayMinutes != null ? String(a.delayMinutes) : "" })));
  }

  async function save(activate: boolean) {
    // Defensa en profundidad: aunque los botones de guardar no se rendericen en
    // estado guardado, save() nunca debe emitir un payload aplanado que pise una
    // regla con ramas de decisión (sub-task 3).
    if (guarded) return;
    setError(null);
    if (!name || name.length < 3) { setError("El nombre debe tener al menos 3 caracteres."); return; }
    if (actions.length === 0) { setError("Agrega al menos una acción."); return; }
    setSaving(true);
    const payload = {
      ...(isEdit ? { id: rule.id } : {}),
      name, description: description || null,
      triggerType, triggerConfig: buildTriggerConfig(triggerType, triggerValue),
      conditions: buildConditionsTree(tree),
      actions: actions.map((a) => ({
        type: a.type,
        config: coerceFieldConfig(a.type, a.config),
        ...(a.delayMinutes && Number(a.delayMinutes) > 0 ? { delayMinutes: Number(a.delayMinutes) } : {}),
      })),
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

  // Estado guardado (sub-task 3): esta regla tiene ramas de decisión que el form plano
  // no puede editar sin destruirlas. No renderizamos el form — solo un banner + salida
  // al canvas de Journey. Save no se ofrece en absoluto (ver también el guard en save()).
  if (guarded) {
    return (
      <div className="space-y-4">
        <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          {DECISION_GUARD_MESSAGE}
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary text-[13px]" onClick={onCancel}>Cerrar</button>
          <a href={rule?.id ? `/journey?mode=targeted&ruleId=${rule.id}` : "/journey"} className="btn-primary text-[13px]">Abrir en Journey</a>
        </div>
      </div>
    );
  }

  const showTriggerValue = ["EVENT", "STAGE_CHANGE", "LIFECYCLE_CHANGE", "SCORE_THRESHOLD", "INACTIVITY"].includes(triggerType);
  const triggerValuePlaceholder =
    triggerType === "EVENT" ? "ej. lead.captured, deal.stage_changed"
    : triggerType === "STAGE_CHANGE" ? "etapa (ej. RESERVED)"
    : triggerType === "LIFECYCLE_CHANGE" ? "etapa del ciclo de vida"
    : triggerType === "SCORE_THRESHOLD" ? "score mínimo (ej. 70)"
    : triggerType === "INACTIVITY" ? "horas sin actividad (ej. 48)" : "";

  return (
    <div className="space-y-5">
      {error && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {/* Plantilla */}
      {!isEdit && (
        <Field label="Empezar desde plantilla (opcional)">
          <select className="form-input text-[13px] max-w-[280px]" defaultValue=""
            onChange={(e) => { if (e.target.value) applyTemplate(e.target.value); }}>
            <option value="">Sin plantilla (desde cero)</option>
            {RULE_TEMPLATES.map((t) => <option key={t.key} value={t.key}>{t.label} — {t.description}</option>)}
          </select>
        </Field>
      )}

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
            {BUILDER_TRIGGER_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          {showTriggerValue && (
            triggerType === "STAGE_CHANGE" ? (
              <select className="form-input text-[13px]" value={triggerValue} onChange={(e) => setTriggerValue(e.target.value)}>
                <option value="">Selecciona etapa…</option>
                {DEAL_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            ) : triggerType === "LIFECYCLE_CHANGE" ? (
              <select className="form-input text-[13px]" value={triggerValue} onChange={(e) => setTriggerValue(e.target.value)}>
                <option value="">Selecciona ciclo de vida…</option>
                {LIFECYCLE_STAGES.map((s) => <option key={s} value={s}>{LIFECYCLE_LABELS[s] ?? s}</option>)}
              </select>
            ) : (
              <input className="form-input text-[13px]" value={triggerValue} onChange={(e) => setTriggerValue(e.target.value)} placeholder={triggerValuePlaceholder} />
            )
          )}
        </div>
      </div>

      {/* Condiciones */}
      <ConditionTreeEditor
        tree={tree}
        onChange={setTree}
        emptyText="Sin condiciones = la regla aplica siempre que dispare el trigger."
      />

      {/* Acciones */}
      <div className="crm-card !p-4 space-y-3">
        <h3 className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>Acciones</h3>
        {actions.map((a, i) => (
          <div key={i} className="rounded-md border p-3" style={{ borderColor: "var(--border-subtle)" }}>
            <div className="flex items-center justify-between gap-2">
              <select className="form-input text-[13px]" value={a.type}
                onChange={(e) => setActions(actions.map((x, j) => j === i ? { type: e.target.value, config: {} } : x))}>
                {BUILDER_ACTION_TYPES.map((t) => <option key={t} value={t}>{labelFor(t)}</option>)}
              </select>
              <button type="button" onClick={() => setActions(actions.filter((_, j) => j !== i))} className="shrink-0 text-[color:var(--text-tertiary)] hover:text-red-600"><X className="h-4 w-4" /></button>
            </div>
            <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
              {(BUILDER_ACTION_FIELDS[a.type] ?? []).map((f) => (
                f.kind === "select" ? (
                  <select key={f.configKey} className="form-input text-[13px]" value={a.config[f.configKey] ?? ""}
                    onChange={(e) => setActions(actions.map((x, j) => j === i ? { ...x, config: { ...x.config, [f.configKey]: e.target.value } } : x))}>
                    <option value="">{f.label}…</option>
                    {(f.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                ) : f.kind === "checkbox" ? (
                  <select key={f.configKey} className="form-input text-[13px]" value={a.config[f.configKey] ?? "false"}
                    onChange={(e) => setActions(actions.map((x, j) => j === i ? { ...x, config: { ...x.config, [f.configKey]: e.target.value } } : x))}>
                    <option value="false">No</option>
                    <option value="true">Sí</option>
                  </select>
                ) : f.kind === "textarea" ? (
                  <textarea key={f.configKey} className="form-input text-[13px]" placeholder={f.placeholder ?? f.label} value={a.config[f.configKey] ?? ""}
                    onChange={(e) => setActions(actions.map((x, j) => j === i ? { ...x, config: { ...x.config, [f.configKey]: e.target.value } } : x))} />
                ) : (
                  <input key={f.configKey} className="form-input text-[13px]" type={f.kind === "number" ? "number" : "text"} placeholder={f.placeholder ?? f.label} value={a.config[f.configKey] ?? ""}
                    onChange={(e) => setActions(actions.map((x, j) => j === i ? { ...x, config: { ...x.config, [f.configKey]: e.target.value } } : x))} />
                )
              ))}
            </div>
            <div className="mt-2">
              <label className="text-[11px] uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>Retrasar (min)</label>
              <input className="form-input max-w-[160px] text-[13px]" type="number" min={0} placeholder="0 = inmediata"
                value={a.delayMinutes ?? ""}
                onChange={(e) => setActions(actions.map((x, j) => j === i ? { ...x, delayMinutes: e.target.value } : x))} />
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
