// Árbol de condiciones DSL reutilizable: all/any · filas campo/op/valor · subgrupos.
// Editor guiado (E2): el dato, el operador y el valor se eligen de listas en español; el modo
// "Avanzado" por fila conserva los inputs libres para campos fuera del catálogo.
// Usado en WorkflowBuilder, CadenceEditor, reparto, territorios, SLA y el Journey.
"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  isGroup, FIELD_SUGGESTIONS,
  type CondLeaf, type CondItem, type CondGroup, type ConditionTree,
} from "@/lib/workflows/builder-model";
import {
  GRUPOS_DE_CAMPO, describeConditions, type ContextoDeCondicion,
} from "@/lib/workflows/condition-catalog";
import {
  buildConditionsTreeGuiado, camposAgrupados, campoDeFila, cambiarCampo, cambiarOperador,
  filaNecesitaAvanzado, operadoresDeFila, opcionesDeValor, tipoDeInput, valorDeInput, valorParaInput,
} from "./condition-tree-model";

const OPS_LIBRES = [
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

interface RowProps {
  c: CondLeaf;
  onChange: (c: CondLeaf) => void;
  onDelete: () => void;
  listId: string;
  contexto: ContextoDeCondicion;
}

function CondRowFields({ c, onChange, onDelete, listId, contexto }: RowProps) {
  // Una fila cuyo campo no está en el catálogo se abre en Avanzado sola.
  const [avanzadoManual, setAvanzadoManual] = useState(false);
  const avanzado = avanzadoManual || filaNecesitaAvanzado(c, contexto);
  const forzado = filaNecesitaAvanzado(c, contexto);

  const toggle = (
    <button
      type="button"
      disabled={forzado}
      onClick={() => setAvanzadoManual((v) => !v)}
      className="shrink-0 text-[11px] underline text-[color:var(--text-tertiary)] hover:text-[color:var(--text-primary)] disabled:no-underline disabled:opacity-60"
      title={forzado ? "Este dato no está en la lista guiada; se edita a mano." : "Cambiar entre elegir de listas y escribir a mano."}
    >
      {avanzado ? (forzado ? "Avanzado" : "Guiado") : "Avanzado"}
    </button>
  );
  const borrar = (
    <button type="button" onClick={onDelete} aria-label="Quitar condición" className="shrink-0 text-[color:var(--text-tertiary)] hover:text-red-600">
      <Trash2 className="h-4 w-4" />
    </button>
  );

  if (avanzado) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <input list={listId} className="form-input !w-auto min-w-[12rem] flex-1 text-[13px]" placeholder="dato del contacto, p. ej. contact.custom.edad" title="Dato que se evalúa. Elige una sugerencia de la lista o escríbelo." value={c.field}
          onChange={(e) => onChange({ ...c, field: e.target.value })} />
        <select className="form-input !w-auto text-[13px]" value={c.op} onChange={(e) => onChange({ ...c, op: e.target.value })}>
          {OPS_LIBRES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {c.op !== "exists" && (
          <input className="form-input !w-auto min-w-[8rem] flex-1 text-[13px]" placeholder={c.op === "in" || c.op === "nin" ? "varios valores separados por coma: A,B,C" : "valor"} value={c.value}
            onChange={(e) => onChange({ ...c, value: e.target.value })} />
        )}
        {toggle}
        {borrar}
      </div>
    );
  }

  const campo = campoDeFila(c);
  const operadores = operadoresDeFila(c);
  const input = tipoDeInput(campo, c.op);
  const editable = valorParaInput(c);
  const setValor = (v: string | string[] | boolean) => onChange({ ...c, value: valorDeInput(campo, c.op, v) });
  const seleccion = Array.isArray(editable) ? editable : typeof editable === "string" && editable ? [editable] : [];
  const opciones = opcionesDeValor(campo, seleccion);

  return (
    <div className="flex flex-wrap items-start gap-2">
      <select className="form-input !w-auto min-w-[12rem] text-[13px]" value={c.field} onChange={(e) => onChange(cambiarCampo(c, e.target.value))} aria-label="Dato">
        <option value="">Elige un dato…</option>
        {camposAgrupados(contexto, GRUPOS_DE_CAMPO).map((g) => (
          <optgroup key={g.grupo} label={g.grupo}>
            {g.campos.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </optgroup>
        ))}
      </select>
      {campo && (
        <select className="form-input !w-auto text-[13px]" value={c.op} onChange={(e) => onChange(cambiarOperador(c, e.target.value))} aria-label="Operador">
          {operadores.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}
      {campo && input === "select" && (
        <select className="form-input !w-auto min-w-[10rem] text-[13px]" value={typeof editable === "string" ? editable : ""} onChange={(e) => setValor(e.target.value)} aria-label="Valor">
          <option value="">Elige un valor…</option>
          {opciones.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}
      {campo && input === "multiselect" && (
        <div className="flex flex-1 flex-wrap gap-1.5" role="group" aria-label="Valores">
          {opciones.map((o) => {
            const on = seleccion.includes(o.value);
            return (
              <label key={o.value} className={`badge cursor-pointer select-none text-[12px] ${on ? "ring-1 ring-current font-semibold" : "opacity-70"}`}>
                <input type="checkbox" className="mr-1" checked={on}
                  onChange={() => setValor(on ? seleccion.filter((v) => v !== o.value) : [...seleccion, o.value])} />
                {o.label}
              </label>
            );
          })}
        </div>
      )}
      {campo && input === "number" && (
        <input type="number" inputMode="decimal" className="form-input !w-auto min-w-[8rem] text-[13px]" placeholder="número" value={typeof editable === "string" ? editable : ""} onChange={(e) => setValor(e.target.value)} aria-label="Valor" />
      )}
      {campo && input === "text" && (
        <input className="form-input !w-auto min-w-[8rem] flex-1 text-[13px]" placeholder="valor" value={typeof editable === "string" ? editable : ""} onChange={(e) => setValor(e.target.value)} aria-label="Valor" />
      )}
      {campo && input === "boolean" && (
        <select className="form-input !w-auto text-[13px]" value={editable === true ? "true" : "false"} onChange={(e) => setValor(e.target.value === "true")} aria-label="Valor">
          <option value="true">Sí</option>
          <option value="false">No</option>
        </select>
      )}
      {campo?.ayuda && <span className="self-center text-[11px]" style={{ color: "var(--text-tertiary)" }}>{campo.ayuda}</span>}
      <span className="ml-auto flex items-center gap-2 self-center">{toggle}{borrar}</span>
    </div>
  );
}

interface ConditionTreeEditorProps {
  tree: ConditionTree;
  onChange: (tree: ConditionTree) => void;
  /** Etiqueta de sección. Por defecto "Condiciones". */
  label?: string;
  /** Texto vacío. Por defecto describe "sin condiciones = aplica siempre". */
  emptyText?: string;
  /** Campos sugeridos en el autocompletado del modo Avanzado. Por defecto los del builder de workflows. */
  fieldSuggestions?: readonly string[];
  /** Id del datalist (único por página si hay editores con sugerencias distintas). */
  listId?: string;
  /** Qué datos se ofrecen: contacto (default), negocio o evento. */
  contexto?: ContextoDeCondicion;
}

export function ConditionTreeEditor({
  tree, onChange, label = "Condiciones", emptyText,
  fieldSuggestions = FIELD_SUGGESTIONS, listId = "field-suggestions", contexto = "contact",
}: ConditionTreeEditorProps) {
  const setRoot = (combinator: "all" | "any") => onChange({ ...tree, combinator });
  const addLeaf = () => onChange({ ...tree, items: [...tree.items, { field: "", op: "eq", value: "" }] });
  const addGroup = () => onChange({ ...tree, items: [...tree.items, { combinator: "all" as const, conditions: [{ field: "", op: "eq", value: "" }] }] });
  const updItem = (i: number, item: CondItem) => onChange({ ...tree, items: tree.items.map((x, j) => j === i ? item : x) });
  const delItem = (i: number) => onChange({ ...tree, items: tree.items.filter((_, j) => j !== i) });
  const frase = describeConditions(buildConditionsTreeGuiado(tree));

  return (
    <div className="crm-card !p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>{label}</h3>
        <div className="flex items-center gap-2 text-[12px]">
          <span style={{ color: "var(--text-tertiary)" }}>Se cumplen</span>
          <select className="form-input !w-auto text-[12px]" value={tree.combinator} onChange={(e) => setRoot(e.target.value as "all" | "any")}>
            <option value="all">todas</option>
            <option value="any">cualquiera</option>
          </select>
        </div>
      </div>
      <datalist id={listId}>{fieldSuggestions.map((f) => <option key={f} value={f} />)}</datalist>
      {tree.items.map((item, i) => isGroup(item) ? (
        <div key={i} className="rounded-md border p-3 space-y-2" style={{ borderColor: "var(--border-subtle)" }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[12px]">
              <span style={{ color: "var(--text-tertiary)" }}>Subgrupo — cumplir</span>
              <select className="form-input !w-auto text-[12px]" value={(item as CondGroup).combinator}
                onChange={(e) => updItem(i, { ...(item as CondGroup), combinator: e.target.value as "all" | "any" })}>
                <option value="all">todas</option><option value="any">cualquiera</option>
              </select>
            </div>
            <button type="button" onClick={() => delItem(i)} aria-label="Quitar subgrupo" className="shrink-0 text-[color:var(--text-tertiary)] hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
          </div>
          {(item as CondGroup).conditions.map((c, k) => (
            <CondRowFields key={k} c={c} listId={listId} contexto={contexto}
              onChange={(nc) => updItem(i, { ...(item as CondGroup), conditions: (item as CondGroup).conditions.map((x, m) => m === k ? nc : x) })}
              onDelete={() => updItem(i, { ...(item as CondGroup), conditions: (item as CondGroup).conditions.filter((_, m) => m !== k) })} />
          ))}
          <button type="button" onClick={() => updItem(i, { ...(item as CondGroup), conditions: [...(item as CondGroup).conditions, { field: "", op: "eq", value: "" }] })} className="btn-secondary text-[12px]">
            <Plus className="h-3.5 w-3.5" /> Condición
          </button>
        </div>
      ) : (
        <CondRowFields key={i} c={item as CondLeaf} listId={listId} contexto={contexto} onChange={(nc) => updItem(i, nc)} onDelete={() => delItem(i)} />
      ))}
      <div className="flex gap-2">
        <button type="button" onClick={addLeaf} className="btn-secondary text-[12px]"><Plus className="h-3.5 w-3.5" /> Condición</button>
        <button type="button" onClick={addGroup} className="btn-secondary text-[12px]"><Plus className="h-3.5 w-3.5" /> Grupo</button>
      </div>
      {tree.items.length === 0 && (
        <p className="text-[12px]" style={{ color: "var(--text-tertiary)" }}>
          {emptyText ?? "Sin condiciones = se aplicará siempre."}
        </p>
      )}
      <p className="text-[12px]" style={{ color: "var(--text-secondary, var(--text-tertiary))" }}>
        <span className="font-semibold">Se cumple cuando:</span> {frase === "siempre" ? "Siempre" : frase}
      </p>
    </div>
  );
}
