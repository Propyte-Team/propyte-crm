// Constructor de reglas "Cuando · Si · Entonces" (E3, 964). La regla se arma y se lee como una
// frase: disparador con nombre, condiciones guiadas (E2) y una tira de tarjetas de acción.
// Lo guardado no cambia (AutomationRule.triggerType/triggerConfig/conditions/actions): la lógica
// de armado, parseo y validación vive en workflow-builder-model.ts.
"use client";

import { useMemo, useState } from "react";
import { erroresPorCampo } from "@/lib/api-errors";
import { RULE_TEMPLATES } from "@/lib/workflows/builder-templates";
import { disparadorPorKey, describeTrigger } from "@/lib/workflows/trigger-catalog";
import { describeRule } from "@/lib/workflows/action-catalog";
import { ConditionTreeEditor } from "./condition-tree";
import { DelayInput, mensajeAutomatizacion } from "./cadence-editor";
import { ActionCard, ActionPicker } from "./action-card";
import { useFuentes } from "./use-fuentes";
import { RuleCanvasEditor } from "@/components/journey/rule-canvas-editor";
import { payloadToDraft, ruleToDraft, type RuleDraft, type RulePayload } from "@/lib/journey/rule-draft";
import {
  DECISION_GUARD_MESSAGE, PRESETS_NO_REPETIR, agregarAccion, avisoDeDisparador, borradorDesdePlantilla, borradorDesdeRegla,
  cambiarDisparador, contextoDeDisparador, disparadoresAgrupados, fraseDeBorrador, fraseDePlantilla,
  fusionarAccion, indiceAbiertoTrasMover, indiceAbiertoTrasQuitar, jsonDeSoloLectura, moverAccion,
  payloadDeBorrador, problemasPorCampo, quitarAccion, shouldGuardRule, validarBorrador,
  type BorradorDeRegla, type CampoConProblema,
} from "./workflow-builder-model";

// Re-exportados: otros módulos los importan de aquí.
export { shouldGuardRule, DECISION_GUARD_MESSAGE };

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>{children}</p>;
}

function Errores({ items }: { items?: string[] }) {
  if (!items?.length) return null;
  return <ul role="alert" className="space-y-0.5">{items.map((m) => <li key={m} className="text-[12px] text-red-600">{m}</li>)}</ul>;
}

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="crm-card !p-4 space-y-3">
      <h3 className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>{titulo}</h3>
      {children}
    </section>
  );
}

interface Props {
  rule?: any;
  onSaved: () => void;
  onCancel: () => void;
}

export function WorkflowBuilder({ rule, onSaved, onCancel }: Props) {
  const isEdit = !!rule;
  // Guard anti data-loss: una regla con nodos de decisión NUNCA se aplana ni se guarda aquí.
  const guarded = shouldGuardRule(rule);
  const { fuentes, listas, error: errorFuentes } = useFuentes();

  const [b, setB] = useState<BorradorDeRegla>(() => borradorDesdeRegla(guarded ? { ...rule, actions: [] } : rule));
  const [abierta, setAbierta] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [intentoGuardar, setIntentoGuardar] = useState(false);
  const [errServidor, setErrServidor] = useState<Record<string, string>>({});
  // Vista avanzada (ramas): lienzo a casi toda la ventana; al guardar cierra el modal, Cancelar vuelve aqui.
  const [avanzada, setAvanzada] = useState<RuleDraft | null>(null);

  const vistaAvanzada = avanzada && (
    <div className="fixed inset-3 z-[60] overflow-hidden rounded-lg border border-neutral-300 shadow-2xl" style={{ background: "var(--bg-card)" }}>
      <RuleCanvasEditor initialDraft={avanzada} onSaved={() => { setAvanzada(null); onSaved(); }} onCancel={() => setAvanzada(null)} />
    </div>
  );

  function convertirEnRamas() {
    try {
      setAvanzada(payloadToDraft(payloadDeBorrador(b, { id: isEdit ? rule.id : undefined, activate: isEdit ? !!rule.isActive : false }) as unknown as RulePayload));
    } catch {
      setError("No se pudo pasar la regla a la vista avanzada. Revisa el disparador y las acciones.");
    }
  }

  const set = (patch: Partial<BorradorDeRegla>) => setB((prev) => ({ ...prev, ...patch }));
  const problemas = useMemo(() => problemasPorCampo(validarBorrador(b, fuentes)), [b, fuentes]);
  // Los errores por campo se muestran tras el primer intento de guardar (no regañan al abrir).
  const ver = (campo: CampoConProblema) => (intentoGuardar ? problemas[campo] : undefined);
  const frase = fraseDeBorrador(b, fuentes);
  const disparador = disparadorPorKey(b.triggerKey);
  const aviso = avisoDeDisparador(b.triggerKey);

  function applyTemplate(key: string) {
    const t = RULE_TEMPLATES.find((x) => x.key === key);
    if (!t) return;
    setB(borradorDesdePlantilla(t));
    setAbierta(null);
  }

  async function save(activate: boolean) {
    // Defensa en profundidad: nunca emitir un payload aplanado de una regla con ramas.
    if (guarded) return;
    setError(null);
    setErrServidor({});
    setIntentoGuardar(true);
    const lista = validarBorrador(b, fuentes);
    if (lista.length > 0) {
      setError(lista[0].mensaje);
      if (lista[0].campo === "actions") {
        const m = /^Acción (\d+):/.exec(lista[0].mensaje);
        if (m) setAbierta(Number(m[1]) - 1);
      }
      return;
    }
    setSaving(true);
    const payload = payloadDeBorrador(b, { id: isEdit ? rule.id : undefined, activate });
    const res = await fetch("/api/admin/automation/rules", {
      method: isEdit ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    if (res.ok) onSaved();
    else {
      const d = await res.json().catch(() => ({}));
      setErrServidor(erroresPorCampo(d));
      setError(mensajeAutomatizacion(d, "No se pudo guardar la regla"));
    }
  }

  if (guarded) {
    return (
      <div className="space-y-4">
        <p className="text-[13px] font-medium text-[color:var(--text-primary)]">{describeRule(rule, fuentes)}</p>
        <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          {DECISION_GUARD_MESSAGE}
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary text-[13px]" onClick={onCancel}>Cerrar</button>
          <button type="button" className="btn-primary text-[13px]" onClick={() => setAvanzada(ruleToDraft(rule))}>Vista avanzada (ramas)</button>
        </div>
        {vistaAvanzada}
      </div>
    );
  }

  const campoDisparador = disparador?.campo;
  const grupos = disparadoresAgrupados(b.triggerKey);

  return (
    <div className="space-y-5">
      {vistaAvanzada}
      {error && <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {errorFuentes && <Hint>No se pudieron cargar las plantillas y cadencias ({errorFuentes}). Puedes seguir editando; no se validarán contra la lista.</Hint>}

      {/* Plantillas */}
      {!isEdit && (
        <div className="space-y-1">
          <label className="text-[11px] uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>Empezar desde una receta (opcional)</label>
          <select className="form-input text-[13px] max-w-[420px]" defaultValue="" onChange={(e) => { if (e.target.value) applyTemplate(e.target.value); }}>
            <option value="">Sin receta (desde cero)</option>
            {RULE_TEMPLATES.map((t) => <option key={t.key} value={t.key}>{t.label} — {fraseDePlantilla(t, fuentes)}</option>)}
          </select>
        </div>
      )}

      {/* Nombre + frase viva */}
      <div className="space-y-2">
        <input className="form-input text-[14px] font-medium" aria-label="Nombre de la regla" value={b.name} onChange={(e) => set({ name: e.target.value })} placeholder="Nombre, p. ej. Bienvenida a leads de Meta" />
        <Errores items={ver("name") ?? (errServidor.name ? [errServidor.name] : undefined)} />
        <p className="rounded-md px-3 py-2 text-[13px] leading-relaxed" style={{ background: "var(--surface-subtle, rgba(0,0,0,0.04))", color: "var(--text-primary)" }} aria-live="polite">
          {frase}
        </p>
      </div>

      {/* Cuando */}
      <Seccion titulo="Cuando">
        <div className="flex flex-wrap items-start gap-2">
          <select className="form-input !w-auto min-w-[16rem] text-[13px]" aria-label="Disparador" value={b.triggerKey} onChange={(e) => { set(cambiarDisparador(b, e.target.value)); }}>
            {!disparador && b.triggerKey && <option value={b.triggerKey}>{describeTrigger(b.triggerOriginal?.triggerType ?? "EVENT", b.triggerOriginal?.triggerConfig)}</option>}
            {grupos.map((g) => (
              <optgroup key={g.grupo} label={g.grupo}>
                {g.disparadores.map((d) => (
                  <option key={d.key} value={d.key}>{d.label}{d.estado === "proximamente" ? " (próximamente)" : ""}</option>
                ))}
              </optgroup>
            ))}
          </select>
          {campoDisparador?.kind === "select" && (
            <select className="form-input !w-auto text-[13px]" aria-label={campoDisparador.label} value={b.triggerValue} onChange={(e) => set({ triggerValue: e.target.value })}>
              <option value="">{campoDisparador.label}…</option>
              {Object.entries(campoDisparador.opciones ?? {}).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          )}
          {campoDisparador?.kind === "number" && (
            <label className="flex items-center gap-1.5 text-[13px]">
              <span className="text-[color:var(--text-secondary)]">{campoDisparador.label}</span>
              <input type="number" min={0} className="form-input !w-24 text-[13px] num" value={b.triggerValue} onChange={(e) => set({ triggerValue: e.target.value })} />
              {campoDisparador.unidad && <span className="text-[color:var(--text-tertiary)]">{campoDisparador.unidad}</span>}
            </label>
          )}
        </div>
        {(disparador?.ayuda || campoDisparador?.ayuda) && !aviso && <Hint>{campoDisparador?.ayuda ?? disparador?.ayuda}</Hint>}
        {aviso && <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">{aviso}</p>}
        <Errores items={ver("trigger") ?? (errServidor.triggerType || errServidor.triggerConfig ? [errServidor.triggerType ?? errServidor.triggerConfig] : undefined)} />
      </Seccion>

      {/* Si */}
      <ConditionTreeEditor
        tree={b.tree}
        onChange={(tree) => set({ tree })}
        label="Si"
        emptyText="Sin condiciones: la regla aplica siempre que ocurra el disparador."
        contexto={contextoDeDisparador(b.triggerKey)}
      />
      <Errores items={ver("conditions")} />

      {/* Entonces */}
      <Seccion titulo="Entonces">
        {b.actions.length === 0 && <Hint>Aún no hay acciones. Agrega la primera.</Hint>}
        <div className="space-y-2">
          {b.actions.map((a, i) => (
            <ActionCard
              key={i}
              action={a}
              index={i}
              total={b.actions.length}
              fuentes={fuentes}
              listas={listas}
              abierta={abierta === i}
              onToggle={() => setAbierta(abierta === i ? null : i)}
              onChange={(next) => set({ actions: b.actions.map((x, j) => (j === i ? fusionarAccion(x, next) : x)) })}
              onMove={(dir) => {
                set({ actions: moverAccion(b.actions, i, dir) });
                setAbierta(indiceAbiertoTrasMover(abierta, i, i + dir));
              }}
              onRemove={() => {
                set({ actions: quitarAccion(b.actions, i) });
                setAbierta(indiceAbiertoTrasQuitar(abierta, i));
              }}
            />
          ))}
        </div>
        <ActionPicker onPick={(nueva) => { set({ actions: agregarAccion(b.actions, nueva) }); setAbierta(b.actions.length); }} />
        <Errores items={ver("actions") ?? (errServidor.actions ? [errServidor.actions] : undefined)} />
      </Seccion>

      {/* Avanzado */}
      <details className="crm-card !p-4">
        <summary className="cursor-pointer text-[12px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>Avanzado</summary>
        <div className="mt-3 space-y-4">
          <div className="space-y-1">
            <label className="text-[11px] uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>Descripción</label>
            <input className="form-input text-[13px]" value={b.description} onChange={(e) => set({ description: e.target.value })} placeholder="Qué hace esta regla" />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>Prioridad (menor = primero)</label>
            <input className="form-input !w-28 text-[13px] num" type="number" value={b.priority} onChange={(e) => set({ priority: e.target.value })} placeholder="100" />
            <Hint>Si varias reglas aplican, se evalúa primero la de número menor. 100 es lo normal.</Hint>
            <Errores items={ver("priority") ?? (errServidor.priority ? [errServidor.priority] : undefined)} />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>No repetir para el mismo contacto durante</label>
            <DelayInput value={b.cooldown} onChange={(v) => set({ cooldown: v })} presets={PRESETS_NO_REPETIR} emptyText="Sin límite: la regla puede repetirse cada vez que ocurra el disparador" />
            <Errores items={ver("cooldown") ?? (errServidor.cooldownMinutes ? [errServidor.cooldownMinutes] : undefined)} />
          </div>
          <div>
            <button type="button" className="text-[12px] underline" style={{ color: "var(--text-tertiary)" }} onClick={convertirEnRamas}>Convertir en flujo con ramas</button>
            <Hint>Abre la vista avanzada con esta regla para agregar decisiones (si … entonces … si no …).</Hint>
          </div>
          <div className="space-y-1">
            <label className="text-[11px] uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>Así se guarda (solo lectura)</label>
            <pre className="max-h-64 overflow-auto rounded-md p-3 text-[11px]" style={{ background: "var(--surface-subtle, rgba(0,0,0,0.04))" }}>{jsonDeSoloLectura(b)}</pre>
          </div>
        </div>
      </details>

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
