// Árbol de condiciones DSL reutilizable: all/any · filas campo/op/valor · subgrupos.
// Usado en WorkflowBuilder (reglas) y CadenceEditor (exitConditions).
"use client";

import { Plus, Trash2 } from "lucide-react";
import {
  isGroup, FIELD_SUGGESTIONS,
  type CondLeaf, type CondItem, type CondGroup, type ConditionTree,
} from "@/lib/workflows/builder-model";

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

function CondRowFields({ c, onChange, onDelete, listId }: { c: CondLeaf; onChange: (c: CondLeaf) => void; onDelete: () => void; listId: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input list={listId} className="form-input !w-auto min-w-[12rem] flex-1 text-[13px]" placeholder="dato del contacto, p. ej. contact.leadSource" title="Dato que se evalúa. Elige una sugerencia de la lista o escríbelo." value={c.field}
        onChange={(e) => onChange({ ...c, field: e.target.value })} />
      <select className="form-input !w-auto text-[13px]" value={c.op} onChange={(e) => onChange({ ...c, op: e.target.value })}>
        {OPS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {c.op !== "exists" && (
        <input className="form-input !w-auto min-w-[8rem] flex-1 text-[13px]" placeholder={c.op === "in" || c.op === "nin" ? "varios valores separados por coma: A,B,C" : "valor, p. ej. FACEBOOK_ADS"} value={c.value}
          onChange={(e) => onChange({ ...c, value: e.target.value })} />
      )}
      <button type="button" onClick={onDelete} className="shrink-0 text-[color:var(--text-tertiary)] hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
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
  /** Campos sugeridos en el autocompletado. Por defecto los del builder de workflows. */
  fieldSuggestions?: readonly string[];
  /** Id del datalist (único por página si hay editores con sugerencias distintas). */
  listId?: string;
}

export function ConditionTreeEditor({
  tree, onChange, label = "Condiciones", emptyText,
  fieldSuggestions = FIELD_SUGGESTIONS, listId = "field-suggestions",
}: ConditionTreeEditorProps) {
  const setRoot = (combinator: "all" | "any") => onChange({ ...tree, combinator });
  const addLeaf = () => onChange({ ...tree, items: [...tree.items, { field: "", op: "eq", value: "" }] });
  const addGroup = () => onChange({ ...tree, items: [...tree.items, { combinator: "all" as const, conditions: [{ field: "", op: "eq", value: "" }] }] });
  const updItem = (i: number, item: CondItem) => onChange({ ...tree, items: tree.items.map((x, j) => j === i ? item : x) });
  const delItem = (i: number) => onChange({ ...tree, items: tree.items.filter((_, j) => j !== i) });

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
        <div key={i} className="rounded-md border p-3" style={{ borderColor: "var(--border-subtle)" }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[12px]">
              <span style={{ color: "var(--text-tertiary)" }}>Subgrupo — cumplir</span>
              <select className="form-input !w-auto text-[12px]" value={(item as CondGroup).combinator}
                onChange={(e) => updItem(i, { ...(item as CondGroup), combinator: e.target.value as "all" | "any" })}>
                <option value="all">todas</option><option value="any">cualquiera</option>
              </select>
            </div>
            <button type="button" onClick={() => delItem(i)} className="shrink-0 text-[color:var(--text-tertiary)] hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
          </div>
          {(item as CondGroup).conditions.map((c, k) => (
            <CondRowFields key={k} c={c} listId={listId}
              onChange={(nc) => updItem(i, { ...(item as CondGroup), conditions: (item as CondGroup).conditions.map((x, m) => m === k ? nc : x) })}
              onDelete={() => updItem(i, { ...(item as CondGroup), conditions: (item as CondGroup).conditions.filter((_, m) => m !== k) })} />
          ))}
          <button type="button" onClick={() => updItem(i, { ...(item as CondGroup), conditions: [...(item as CondGroup).conditions, { field: "", op: "eq", value: "" }] })} className="btn-secondary text-[12px] mt-2">
            <Plus className="h-3.5 w-3.5" /> Condición
          </button>
        </div>
      ) : (
        <CondRowFields key={i} c={item as CondLeaf} listId={listId} onChange={(nc) => updItem(i, nc)} onDelete={() => delItem(i)} />
      ))}
      <div className="flex gap-2">
        <button type="button" onClick={addLeaf} className="btn-secondary text-[12px]"><Plus className="h-3.5 w-3.5" /> Condición</button>
        <button type="button" onClick={addGroup} className="btn-secondary text-[12px]"><Plus className="h-3.5 w-3.5" /> Grupo</button>
      </div>
      <p className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
        Por ahora el dato y el valor se escriben a mano (p. ej. contact.leadSource igual a FACEBOOK_ADS).
        En la siguiente etapa se elegirán de una lista, sin teclear claves.
      </p>
      {tree.items.length === 0 && (
        <p className="text-[12px]" style={{ color: "var(--text-tertiary)" }}>
          {emptyText ?? "Sin condiciones = se aplicará siempre."}
        </p>
      )}
    </div>
  );
}
