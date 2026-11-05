"use client";
// Inspector lateral del lienzo editable, en lenguaje de negocio (E4-B).
// Disparador, acciones y condiciones usan los mismos catalogos y controles que Configuracion.
// El JSON crudo queda bajo "Avanzado".

import { useRef, useState } from "react";
import type { RuleDraft, NodeDraft, DecisionNodeDraft, ActionNodeDraft } from "@/lib/journey/rule-draft";
import { isDecisionDraft } from "@/lib/journey/rule-draft";
import { ConditionTreeEditor } from "@/components/config/condition-tree";
import { buildConditionsTreeGuiado } from "@/components/config/condition-tree-model";
import { parseConditions } from "@/lib/workflows/builder-model";
import { describeRule, type CampoDeAccion } from "@/lib/workflows/action-catalog";
import { DelayInput } from "@/components/config/cadence-editor";
import { useFuentes } from "@/components/config/use-fuentes";
import {
  PRESETS_DE_RETRASO, cambiarRaw, inputDeCampo, opcionesDeInput, valorCheckbox, valorDeSelect,
  valorTexto, VALOR_OTRO, type ListasDeFuentes,
} from "@/components/config/action-card-model";
import { DecisionInspector } from "./decision-inspector";
import {
  contextoDeRegla, disparadorAlEditarValor, disparadorAlElegir, firmaDeConfig, findNode,
  minutosDeRetraso, opcionesDeTipoDeAccion, parcheDeConfig, problemasDeNodo, rawDesdeConfig,
  retrasoATexto, selectorDeDisparador, vistaDeAccion, vistaDeInspector,
} from "./rule-inspector-model";

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
  addDecision: () => void;
  removeNode: (nodeId: string) => void;
  setDecisionLabel: (nodeId: string, label: string) => void;
  addBranch: (decisionNodeId: string) => void;
  removeBranch: (branchId: string) => void;
  setBranchLabel: (branchId: string, label: string) => void;
  setBranchConditions: (branchId: string, c: RuleDraft["conditions"]) => void;
  addActionToBranch: (branchId: string, type: string) => void;
  addActionToElse: (decisionNodeId: string, type: string) => void;
  setElseEnabled: (decisionNodeId: string, enabled: boolean) => void;
}

interface RuleInspectorPanelProps {
  draft: RuleDraft;
  selectedId: string | null;
  ops: Ops;
  /** Oculta «Regla activa» cuando quien lo usa ya tiene su propio interruptor (lienzo de /journey). */
  sinActiva?: boolean;
}

// Clases compartidas (coherentes con action-card / Configuracion).
const ASIDE = "crm-card !p-4 space-y-3 text-[12px]";
const TITULO = "text-[12px] font-semibold uppercase tracking-wider text-[color:var(--text-tertiary)]";
const ETIQUETA = "block text-[12px] font-medium text-[color:var(--text-secondary)]";
const AYUDA = "text-[11px] text-[color:var(--text-tertiary)]";

// -- Campo de accion (mismos controles que action-card) -------------------------------
function CampoDeAccionInput({
  campo, raw, listas, onSet,
}: {
  campo: CampoDeAccion;
  raw: Record<string, unknown>;
  listas: ListasDeFuentes;
  onSet: (key: string, valor: unknown) => void;
}) {
  const [modoOtro, setModoOtro] = useState(false);
  const tipo = inputDeCampo(campo);
  const id = `insp-${campo.key}`;

  let control: React.ReactNode;
  if (tipo === "text") {
    control = <input id={id} className="form-input text-[13px]" placeholder={campo.placeholder} value={valorTexto(raw, campo.key)} onChange={(e) => onSet(campo.key, e.target.value)} />;
  } else if (tipo === "textarea") {
    control = <textarea id={id} rows={3} className="form-input text-[13px]" placeholder={campo.placeholder} value={valorTexto(raw, campo.key)} onChange={(e) => onSet(campo.key, e.target.value)} />;
  } else if (tipo === "number") {
    control = <input id={id} type="number" className="form-input !w-32 text-[13px] num" placeholder={campo.placeholder} value={valorTexto(raw, campo.key)} onChange={(e) => onSet(campo.key, e.target.value)} />;
  } else if (tipo === "minutos") {
    control = <DelayInput value={valorTexto(raw, campo.key)} onChange={(m) => onSet(campo.key, m)} emptyText={campo.ayuda ?? "Sin valor"} />;
  } else if (tipo === "checkbox") {
    control = (
      <label className="flex items-center gap-2 text-[13px]">
        <input id={id} type="checkbox" checked={valorCheckbox(raw, campo.key)} onChange={(e) => onSet(campo.key, e.target.checked)} />
        {campo.label}
      </label>
    );
  } else {
    const { opciones, valorFueraDeLista } = opcionesDeInput(campo, raw, listas);
    const valor = valorDeSelect(campo, raw, listas, modoOtro);
    control = (
      <div className="space-y-1.5">
        <select
          id={id}
          className="form-input text-[13px]"
          value={valor}
          onChange={(e) => {
            if (e.target.value === VALOR_OTRO) { setModoOtro(true); return; }
            setModoOtro(false);
            onSet(campo.key, e.target.value);
          }}
        >
          <option value="">Elige…</option>
          {opciones.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          {valorFueraDeLista !== null && !campo.permiteOtro && (
            <option value={valorFueraDeLista}>{valorFueraDeLista} (valor guardado)</option>
          )}
          {campo.permiteOtro && <option value={VALOR_OTRO}>Otro…</option>}
        </select>
        {valor === VALOR_OTRO && (
          <input className="form-input text-[13px]" placeholder="Escribe el valor" aria-label={`${campo.label} (otro)`}
            value={valorTexto(raw, campo.key)} onChange={(e) => onSet(campo.key, e.target.value)} />
        )}
        {campo.kind === "fuente" && opciones.length === 0 && valorFueraDeLista === null && (
          <p className={AYUDA}>No hay opciones disponibles todavía.</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {tipo !== "checkbox" && (
        <label htmlFor={id} className={ETIQUETA}>
          {campo.label}{campo.requerido && <span className="text-red-600"> *</span>}
        </label>
      )}
      {control}
      {campo.ayuda && tipo !== "minutos" && <p className={AYUDA}>{campo.ayuda}</p>}
    </div>
  );
}

// -- Formulario de una accion ---------------------------------------------------------
// Conserva el texto crudo mientras se escribe (los espacios finales no se recortan hasta guardar)
// y se re-sincroniza si la config cambia desde fuera (JSON avanzado, cambio de tipo).
function AccionForm({
  node, listas, onPatch,
}: {
  node: ActionNodeDraft;
  listas: ListasDeFuentes;
  onPatch: (patch: Record<string, unknown>) => void;
}) {
  const firma = firmaDeConfig(node.config);
  const [raw, setRaw] = useState<Record<string, unknown>>(() => rawDesdeConfig(node.config));
  const emitida = useRef(firma);
  if (emitida.current !== firma) {
    emitida.current = firma;
    setRaw(rawDesdeConfig(node.config));
  }
  const vista = vistaDeAccion(node);

  const onSet = (key: string, valor: unknown) => {
    const next = cambiarRaw(node.type, raw, key, valor);
    const parche = parcheDeConfig(node.type, node.config, next);
    emitida.current = firmaDeConfig({ ...node.config, ...parche });
    setRaw(next);
    onPatch(parche);
  };

  if (vista.campos.length === 0) {
    return <p className={AYUDA}>{vista.desconocida ? "Tipo de acción que el catálogo no conoce; usa Avanzado para editarla." : "Esta acción no necesita datos."}</p>;
  }
  return (
    <div className="space-y-3">
      {vista.campos.map((c) => (
        <CampoDeAccionInput key={`${node.type}:${c.key}`} campo={c} raw={raw} listas={listas} onSet={onSet} />
      ))}
    </div>
  );
}

// -- Componente -----------------------------------------------------------------------
export function RuleInspectorPanel({ draft, selectedId, ops, sinActiva = false }: RuleInspectorPanelProps) {
  const { listas, fuentes } = useFuentes();
  const vista = vistaDeInspector(draft.actions, selectedId);
  const selected: NodeDraft | undefined = selectedId ? findNode(draft.actions, selectedId) : undefined;
  const contexto = contextoDeRegla(draft.triggerType, draft.triggerConfig);
  const resumen = describeRule(
    { triggerType: draft.triggerType, triggerConfig: draft.triggerConfig, conditions: draft.conditions, actions: draft.actions },
    fuentes,
  );

  const frase = (
    <p className="rounded-md bg-[color:var(--bg-hover)] px-2.5 py-2 text-[12px] leading-snug text-[color:var(--text-secondary)]">{resumen}</p>
  );

  // -- Disparador -----------------------------------------------------------------------
  if (vista === "disparador") {
    const s = selectorDeDisparador(draft.triggerType, draft.triggerConfig);
    return (
      <aside className={ASIDE}>
        {frase}
        <h3 className={TITULO}>Disparador</h3>
        <div className="space-y-1">
          <label htmlFor="insp-disparador" className={ETIQUETA}>Cuándo se activa</label>
          <select
            id="insp-disparador"
            className="form-input text-[13px]"
            value={s.key}
            onChange={(e) => ops.setTrigger(disparadorAlElegir(e.target.value))}
          >
            {!s.key && <option value="">Elige…</option>}
            {s.grupos.map((g) => (
              <optgroup key={g.grupo} label={g.grupo}>
                {g.opciones.map((o) => (
                  <option key={o.key} value={o.key}>{o.label}{o.proximamente ? " (próximamente)" : ""}</option>
                ))}
              </optgroup>
            ))}
          </select>
          {s.aviso && <p className="text-[11px] text-amber-700">{s.aviso}</p>}
        </div>
        {s.campo && (
          <div className="space-y-1">
            <label htmlFor="insp-disparador-valor" className={ETIQUETA}>
              {s.campo.label}{s.campo.requerido && <span className="text-red-600"> *</span>}
            </label>
            {s.campo.kind === "select" ? (
              <select
                id="insp-disparador-valor"
                className="form-input text-[13px]"
                value={s.valor}
                onChange={(e) => ops.setTrigger(disparadorAlEditarValor(s.key, e.target.value))}
              >
                <option value="">{s.campo.requerido ? "Elige…" : "Cualquiera"}</option>
                {Object.entries(s.campo.opciones ?? {}).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            ) : (
              <div className="flex items-center gap-2">
                <input
                  id="insp-disparador-valor"
                  type="number"
                  min={0}
                  className="form-input !w-32 text-[13px] num"
                  value={s.valor}
                  onChange={(e) => ops.setTrigger(disparadorAlEditarValor(s.key, e.target.value))}
                />
                {s.campo.unidad && <span className={AYUDA}>{s.campo.unidad}</span>}
              </div>
            )}
            {s.campo.ayuda && <p className={AYUDA}>{s.campo.ayuda}</p>}
          </div>
        )}
        <details>
          <summary className="cursor-pointer text-[11px] text-[color:var(--text-tertiary)]">Avanzado</summary>
          <JsonField
            key="trigger"
            label="Datos técnicos del disparador"
            value={draft.triggerConfig}
            onChange={(v) => ops.setTrigger({ triggerType: draft.triggerType, triggerConfig: v })}
          />
        </details>
      </aside>
    );
  }

  // -- Condicion ------------------------------------------------------------------------
  if (vista === "condicion") {
    return (
      <aside className={ASIDE}>
        {frase}
        <ConditionTreeEditor
          tree={parseConditions(draft.conditions)}
          onChange={(tree) => ops.setConditions(buildConditionsTreeGuiado(tree) as RuleDraft["conditions"])}
          label="Condiciones de la regla"
          contexto={contexto}
        />
      </aside>
    );
  }

  // -- Decision -------------------------------------------------------------------------
  if (vista === "decision" && selected && isDecisionDraft(selected)) {
    const decision = selected as DecisionNodeDraft;
    return (
      <div className="space-y-3">
        {frase}
        <DecisionInspector
          decision={decision}
          contexto={contexto}
          ops={{
            setDecisionLabel: ops.setDecisionLabel,
            addBranch: ops.addBranch,
            removeBranch: ops.removeBranch,
            setBranchLabel: ops.setBranchLabel,
            setBranchConditions: ops.setBranchConditions,
            addActionToBranch: ops.addActionToBranch,
            addActionToElse: ops.addActionToElse,
            setElseEnabled: ops.setElseEnabled,
          }}
        />
      </div>
    );
  }

  // -- Accion ---------------------------------------------------------------------------
  if (vista === "accion" && selected && !isDecisionDraft(selected)) {
    const action = selected as ActionNodeDraft;
    const v = vistaDeAccion(action, fuentes);
    const problemas = problemasDeNodo(action, fuentes);
    const grupos = opcionesDeTipoDeAccion(action.type);
    return (
      <aside className={ASIDE}>
        {frase}
        <div>
          <h3 className={TITULO}>Acción</h3>
          <p className="mt-1 text-[13px] font-medium text-[color:var(--text-primary)]">{v.titulo}</p>
        </div>
        <div className="space-y-1">
          <label htmlFor="insp-tipo" className={ETIQUETA}>Qué hace</label>
          <select
            id="insp-tipo"
            className="form-input text-[13px]"
            value={action.type}
            onChange={(e) => ops.setActionType(action.nodeId, e.target.value)}
          >
            {grupos.map((g) => (
              <optgroup key={g.grupo} label={g.grupo}>
                {g.acciones.map((a) => <option key={a.type} value={a.type}>{a.label}</option>)}
              </optgroup>
            ))}
          </select>
          {v.proximamente && <p className="text-[11px] text-amber-700">Esta acción todavía no está disponible en el motor.</p>}
        </div>

        <AccionForm
          key={`${action.nodeId}:${action.type}`}
          node={action}
          listas={listas}
          onPatch={(patch) => ops.setActionConfig(action.nodeId, patch)}
        />

        <div className="space-y-1">
          <span className={ETIQUETA}>Cuándo se ejecuta</span>
          <DelayInput
            value={retrasoATexto(action.delayMinutes)}
            onChange={(m) => ops.setActionDelay(action.nodeId, minutosDeRetraso(m))}
            presets={PRESETS_DE_RETRASO}
            emptyText="Inmediata"
          />
        </div>

        {problemas.length > 0 && (
          <ul className="space-y-0.5 rounded-md bg-amber-50 px-2.5 py-2 text-[11px] text-amber-800">
            {problemas.map((p) => <li key={p}>{p}</li>)}
          </ul>
        )}

        <details>
          <summary className="cursor-pointer text-[11px] text-[color:var(--text-tertiary)]">Avanzado</summary>
          <JsonField
            key={`${action.nodeId}:${action.type}`}
            label="Datos técnicos de la acción"
            value={action.config}
            onChange={(c) => ops.setActionConfig(action.nodeId, sustituirConfig(action.config, c))}
          />
        </details>

        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary !min-h-0 !px-2.5 !py-1 !text-[12px]" aria-label="Subir" onClick={() => ops.reorderAction(action.nodeId, "up")}>↑ Subir</button>
          <button type="button" className="btn-secondary !min-h-0 !px-2.5 !py-1 !text-[12px]" aria-label="Bajar" onClick={() => ops.reorderAction(action.nodeId, "down")}>↓ Bajar</button>
          <button type="button" className="btn-secondary !min-h-0 !px-2.5 !py-1 !text-[12px]" onClick={() => ops.removeNode(action.nodeId)}>Quitar paso</button>
        </div>
      </aside>
    );
  }

  // -- Regla (nada seleccionado) --------------------------------------------------------
  return (
    <aside className={ASIDE}>
      {frase}
      <h3 className={TITULO}>Regla</h3>
      <div className="space-y-1">
        <label htmlFor="insp-nombre" className={ETIQUETA}>Nombre</label>
        <input id="insp-nombre" className="form-input text-[13px]" placeholder="Nombre de la regla" value={draft.name} onChange={(e) => ops.setMeta({ name: e.target.value })} />
      </div>
      <div className="space-y-1">
        <label htmlFor="insp-desc" className={ETIQUETA}>Descripción</label>
        <textarea id="insp-desc" rows={2} className="form-input text-[13px]" placeholder="Para qué sirve" value={draft.description ?? ""} onChange={(e) => ops.setMeta({ description: e.target.value || null })} />
      </div>
      <div className="space-y-1">
        <label htmlFor="insp-prio" className={ETIQUETA}>Prioridad</label>
        <input id="insp-prio" className="form-input !w-24 text-[13px] num" type="number" min={1} max={1000} value={draft.priority} onChange={(e) => ops.setMeta({ priority: Number(e.target.value) })} />
        <p className={AYUDA}>Si varias reglas coinciden, corre primero la de número menor.</p>
      </div>
      {!sinActiva && (
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={draft.isActive} onChange={(e) => ops.setMeta({ isActive: e.target.checked })} />
          Regla activa
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary !min-h-0 !px-2.5 !py-1 !text-[12px]" onClick={() => ops.addAction("NOTIFY")}>+ Añadir acción</button>
        <button type="button" className="btn-secondary !min-h-0 !px-2.5 !py-1 !text-[12px]" onClick={() => ops.addDecision()}>+ Añadir decisión</button>
      </div>
    </aside>
  );
}

/** `setActionConfig` mezcla: para que el JSON avanzado REEMPLACE la config, las claves que ya no están se borran. */
function sustituirConfig(actual: Record<string, unknown>, nueva: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...nueva };
  for (const k of Object.keys(actual)) if (!(k in nueva)) out[k] = undefined;
  return out;
}

// -- JsonField ------------------------------------------------------------------------
// Texto local para permitir JSON parcialmente invalido mientras se escribe. Se remonta por key
// cuando cambia el valor externo.
function JsonField({
  label, value, onChange,
}: {
  label: string;
  value: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
}) {
  const firma = firmaDeConfig(value);
  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  const [bad, setBad] = useState(false);
  const emitida = useRef(firma);
  // Cambio externo (formulario de arriba): se reescribe el texto. Cambio propio: no se toca.
  if (emitida.current !== firma) {
    emitida.current = firma;
    setText(JSON.stringify(value, null, 2));
    setBad(false);
  }
  return (
    <div className="mt-2 space-y-1">
      <label className={ETIQUETA}>{label}</label>
      <textarea
        className="form-input font-mono text-[11px]"
        rows={5}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          try {
            const v = JSON.parse(e.target.value) as unknown;
            if (!v || typeof v !== "object" || Array.isArray(v)) { setBad(true); return; }
            emitida.current = firmaDeConfig(v as Record<string, unknown>);
            onChange(v as Record<string, unknown>);
            setBad(false);
          } catch {
            setBad(true);
          }
        }}
      />
      {bad && <p className="text-[11px] text-red-600">El formato no es válido; el último valor correcto sigue guardado.</p>}
    </div>
  );
}
