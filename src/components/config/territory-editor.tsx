// Editor de un territorio: miembros (usuario + nivel de acceso) y reglas de entrada
// (prioridad + condiciones + activa). Guardar manda la lista completa al
// PUT /api/admin/territories, que reemplaza miembros y reglas de ese territorio.
"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { ConditionTreeEditor } from "./condition-tree";
import { buildConditionsTree, parseConditions, type ConditionTree } from "@/lib/workflows/builder-model";
import { ROUTING_FIELD_SUGGESTIONS, nextPriority } from "@/lib/teams/rules-model";

export interface TerritoryRuleData { id?: string; priority: number; isActive: boolean; conditions?: unknown }
export interface TerritoryMemberData { accessLevel: string; user: { id: string; name: string } }
interface UserOpt { id: string; name: string }

interface MemberRow { userId: string; accessLevel: "VIEW" | "EDIT" }
interface RuleRow { priority: number; isActive: boolean; tree: ConditionTree }

export function TerritoryEditor({
  territoryId, members, rules, users, onSaved, onCancel,
}: {
  territoryId: string;
  members: TerritoryMemberData[];
  rules: TerritoryRuleData[];
  users: UserOpt[];
  onSaved: (msg: string) => void;
  onCancel: () => void;
}) {
  const [memberRows, setMemberRows] = useState<MemberRow[]>(
    members.map((m) => ({ userId: m.user.id, accessLevel: m.accessLevel === "EDIT" ? "EDIT" : "VIEW" })),
  );
  const [ruleRows, setRuleRows] = useState<RuleRow[]>(
    rules.map((r) => ({ priority: r.priority, isActive: r.isActive, tree: parseConditions(r.conditions) })),
  );
  const [addUser, setAddUser] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const updRule = (i: number, patch: Partial<RuleRow>) => setRuleRows(ruleRows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function save() {
    setSaving(true);
    setErr("");
    const res = await fetch("/api/admin/territories", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        territoryId,
        members: memberRows,
        rules: ruleRows.map((r) => ({ priority: r.priority, isActive: r.isActive, conditions: buildConditionsTree(r.tree) })),
      }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) { setErr(typeof data.error === "string" ? data.error : "No se pudo guardar el territorio"); return; }
    onSaved("Territorio actualizado ✓");
  }

  const available = users.filter((u) => !memberRows.some((m) => m.userId === u.id));
  const nameOf = (id: string) => users.find((u) => u.id === id)?.name ?? id.slice(0, 8);

  return (
    <div className="mt-3 space-y-4 rounded-md border p-3" style={{ borderColor: "var(--border-subtle)" }}>
      <div className="space-y-2">
        <p className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>Miembros</p>
        <p className="text-[12px]" style={{ color: "var(--text-tertiary)" }}>
          Solo los miembros reciben los leads que caen en este territorio. Sin miembros, el territorio no restringe a nadie.
        </p>
        <div className="flex flex-wrap gap-2">
          {memberRows.map((m, i) => (
            <span key={m.userId} className="badge badge-neutral inline-flex items-center gap-1.5">
              {nameOf(m.userId)}
              <select className="form-input !w-auto !py-0 !px-1 text-[11px]" value={m.accessLevel}
                onChange={(e) => setMemberRows(memberRows.map((x, j) => (j === i ? { ...x, accessLevel: e.target.value as "VIEW" | "EDIT" } : x)))}>
                <option value="VIEW">ver</option><option value="EDIT">editar</option>
              </select>
              <button type="button" title="Quitar" onClick={() => setMemberRows(memberRows.filter((_, j) => j !== i))}><Trash2 className="h-3 w-3" /></button>
            </span>
          ))}
          <span className="inline-flex items-center gap-1">
            <select className="form-input !w-44 !py-1 text-[12px]" value={addUser} onChange={(e) => setAddUser(e.target.value)}>
              <option value="">+ agregar miembro</option>
              {available.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            {addUser && (
              <button type="button" className="btn-secondary !py-1 !px-2 text-[12px]" onClick={() => { setMemberRows([...memberRows, { userId: addUser, accessLevel: "VIEW" }]); setAddUser(""); }}>OK</button>
            )}
          </span>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>Reglas de entrada</p>
        <p className="text-[12px]" style={{ color: "var(--text-tertiary)" }}>
          Un lead cae en este territorio cuando cumple alguna regla activa. Entre territorios, gana el más específico (hijo antes que padre) y luego la menor prioridad.
        </p>
        {ruleRows.map((r, i) => (
          <div key={i} className="space-y-2 rounded-md border p-2" style={{ borderColor: "var(--border-subtle)" }}>
            <div className="flex flex-wrap items-center gap-3 text-[12px]">
              <label className="inline-flex items-center gap-1.5">
                Prioridad
                <input type="number" min={1} max={1000} className="form-input !w-20 !py-1 text-[12px]" value={r.priority} onChange={(e) => updRule(i, { priority: Number(e.target.value) || 1 })} />
              </label>
              <label className="inline-flex items-center gap-1.5">
                <input type="checkbox" checked={r.isActive} onChange={(e) => updRule(i, { isActive: e.target.checked })} /> activa
              </label>
              <button type="button" className="ml-auto text-[color:var(--text-tertiary)] hover:text-red-600" title="Quitar regla" onClick={() => setRuleRows(ruleRows.filter((_, j) => j !== i))}>
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            <ConditionTreeEditor
              tree={r.tree}
              onChange={(tree) => updRule(i, { tree })}
              label="Entra cuando"
              emptyText="Sin condiciones = todos los leads caen aquí."
              fieldSuggestions={ROUTING_FIELD_SUGGESTIONS}
              listId="routing-field-suggestions"
            />
          </div>
        ))}
        <button type="button" className="btn-secondary text-[12px]" onClick={() => setRuleRows([...ruleRows, { priority: nextPriority(ruleRows), isActive: true, tree: { combinator: "all", items: [] } }])}>
          <Plus className="h-3.5 w-3.5" /> Regla de entrada
        </button>
      </div>

      {err && <p className="text-[12px] text-red-600">{err}</p>}
      <div className="flex gap-2">
        <button type="button" className="btn-primary !py-1.5 !px-3 text-[12px]" disabled={saving} onClick={save}>{saving ? "Guardando…" : "Guardar territorio"}</button>
        <button type="button" className="btn-secondary !py-1.5 !px-3 text-[12px]" onClick={onCancel}>Cancelar</button>
      </div>
    </div>
  );
}
