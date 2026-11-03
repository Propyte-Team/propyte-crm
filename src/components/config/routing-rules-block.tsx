// Configuración → Equipos & Territorios → Reglas de ruteo (RoutingRule).
// Lista por prioridad + formulario inline. Escribe /api/admin/routing-rules; el motor que
// las aplica es autoRouteLead. Las reglas se evalúan en orden de prioridad (menor primero)
// y gana la primera que matchea y encuentra candidato.
"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Pencil, Trash2, Power } from "lucide-react";
import { ConditionTreeEditor } from "./condition-tree";
import { buildConditionsTree, parseConditions, type ConditionTree } from "@/lib/workflows/builder-model";
import {
  ROUTING_FIELD_SUGGESTIONS, STRATEGY_LABELS, describeConditions, describeTargets,
  buildTargets, parseTargets, nextPriority,
} from "@/lib/teams/rules-model";
import { ROUTING_STRATEGIES, ROUTING_TARGET_ROLES, ROUTING_PLAZAS } from "@/lib/validations/routing-rule";

export interface RoutingRuleData {
  id: string;
  name: string;
  priority: number;
  isActive: boolean;
  conditions: unknown;
  strategy: string;
  targets: unknown;
}
interface UserOpt { id: string; name: string; role: string; plaza?: string | null }

interface FormState {
  name: string;
  priority: number;
  strategy: string;
  mode: "roles" | "users";
  roles: string[];
  userIds: string[];
  plaza: string;
  tree: ConditionTree;
}

const PLAZA_LABEL: Record<string, string> = { TULUM: "Tulum", PDC: "PDC", MERIDA: "Mérida" };

function emptyForm(priority: number): FormState {
  return { name: "", priority, strategy: "ROUND_ROBIN", mode: "roles", roles: [], userIds: [], plaza: "", tree: { combinator: "all", items: [] } };
}

function formFromRule(r: RoutingRuleData): FormState {
  const t = parseTargets(r.targets);
  return { name: r.name, priority: r.priority, strategy: r.strategy, ...t, tree: parseConditions(r.conditions) };
}

export function RoutingRulesBlock({ userRole, users }: { userRole: string; users: UserOpt[] }) {
  const canEdit = ["ADMIN", "DIRECTOR", "GERENTE"].includes(userRole);
  const canCreate = ["ADMIN", "DIRECTOR"].includes(userRole);
  const [rules, setRules] = useState<RoutingRuleData[]>([]);
  const [editing, setEditing] = useState<{ id: string | null; form: FormState } | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/routing-rules");
    if (res.ok) setRules((await res.json()).data ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const usersById = Object.fromEntries(users.map((u) => [u.id, u.name]));

  async function save() {
    if (!editing) return;
    const f = editing.form;
    if (f.name.trim().length < 3) { setMsg("El nombre necesita al menos 3 caracteres"); return; }
    setSaving(true);
    const body = {
      name: f.name.trim(),
      priority: f.priority,
      strategy: f.strategy,
      conditions: buildConditionsTree(f.tree),
      targets: buildTargets(f),
    };
    const res = await fetch(editing.id ? `/api/admin/routing-rules/${editing.id}` : "/api/admin/routing-rules", {
      method: editing.id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) { setMsg(typeof data.error === "string" ? data.error : "No se pudo guardar la regla"); return; }
    setMsg(editing.id ? "Regla actualizada ✓" : "Regla creada ✓");
    setEditing(null);
    load();
  }

  async function toggleActive(r: RoutingRuleData) {
    const res = await fetch(`/api/admin/routing-rules/${r.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !r.isActive }),
    });
    if (!res.ok) setMsg("No se pudo cambiar el estado");
    load();
  }

  async function remove(r: RoutingRuleData) {
    if (!window.confirm(`¿Eliminar la regla "${r.name}"? Los leads dejarán de repartirse con ella.`)) return;
    const res = await fetch(`/api/admin/routing-rules/${r.id}`, { method: "DELETE" });
    setMsg(res.ok ? "Regla eliminada" : "No se pudo eliminar");
    load();
  }

  const setForm = (patch: Partial<FormState>) => editing && setEditing({ ...editing, form: { ...editing.form, ...patch } });
  const toggleIn = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const asesores = users.filter((u) => (ROUTING_TARGET_ROLES as readonly string[]).includes(u.role));

  return (
    <div className="crm-card !p-0 overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 hairline-b">
        <div>
          <p className="text-[13px] font-semibold">Reglas de ruteo</p>
          <p className="text-[12px]" style={{ color: "var(--text-tertiary)" }}>
            Se evalúan por prioridad (menor primero); gana la primera que cumple y tiene a quién asignar. Si ninguna asigna, el lead entra al turno general.
          </p>
        </div>
        {canCreate && !editing && (
          <button className="btn-primary !py-1.5 !px-3 text-[12px]" onClick={() => setEditing({ id: null, form: emptyForm(nextPriority(rules)) })}>
            <Plus className="h-3.5 w-3.5" /> Nueva regla
          </button>
        )}
      </div>
      {msg && <p className="px-4 pt-2 text-[12px]" style={{ color: "var(--text-secondary)" }}>{msg}</p>}

      {editing && (
        <div className="space-y-3 px-4 py-3 hairline-b" style={{ background: "var(--bg-subtle, transparent)" }}>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-[12px]">
              <span className="block mb-1" style={{ color: "var(--text-tertiary)" }}>Nombre</span>
              <input className="form-input !w-64 !py-1.5 text-[13px]" placeholder="Ej. Leads de Meta a Tulum" value={editing.form.name} onChange={(e) => setForm({ name: e.target.value })} />
            </label>
            <label className="text-[12px]">
              <span className="block mb-1" style={{ color: "var(--text-tertiary)" }}>Prioridad</span>
              <input type="number" min={1} max={1000} className="form-input !w-24 !py-1.5 text-[13px]" value={editing.form.priority} onChange={(e) => setForm({ priority: Number(e.target.value) || 1 })} />
            </label>
            <label className="text-[12px]">
              <span className="block mb-1" style={{ color: "var(--text-tertiary)" }}>Estrategia</span>
              <select className="form-input !w-56 !py-1.5 text-[13px]" value={editing.form.strategy} onChange={(e) => setForm({ strategy: e.target.value })}>
                {ROUTING_STRATEGIES.map((s) => <option key={s} value={s}>{STRATEGY_LABELS[s]}</option>)}
              </select>
            </label>
          </div>

          <div className="space-y-2">
            <p className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>Asignar a</p>
            <div className="flex flex-wrap gap-4 text-[13px]">
              <label className="inline-flex items-center gap-1.5">
                <input type="radio" checked={editing.form.mode === "roles"} onChange={() => setForm({ mode: "roles" })} /> Por rol y plaza
              </label>
              <label className="inline-flex items-center gap-1.5">
                <input type="radio" checked={editing.form.mode === "users"} onChange={() => setForm({ mode: "users" })} /> Usuarios específicos
              </label>
            </div>
            {editing.form.mode === "roles" ? (
              <div className="flex flex-wrap items-center gap-3 text-[13px]">
                {ROUTING_TARGET_ROLES.map((r) => (
                  <label key={r} className="inline-flex items-center gap-1.5">
                    <input type="checkbox" checked={editing.form.roles.includes(r)} onChange={() => setForm({ roles: toggleIn(editing.form.roles, r) })} /> {r}
                  </label>
                ))}
                <select className="form-input !w-44 !py-1 text-[12px]" value={editing.form.plaza} onChange={(e) => setForm({ plaza: e.target.value })}>
                  <option value="">Plaza del lead</option>
                  {ROUTING_PLAZAS.map((p) => <option key={p} value={p}>{PLAZA_LABEL[p]}</option>)}
                </select>
                <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>Sin roles marcados = asesores (todos los niveles)</span>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2 text-[13px]">
                {asesores.length === 0 && <span style={{ color: "var(--text-tertiary)" }}>No hay usuarios con rol de asesor.</span>}
                {asesores.map((u) => (
                  <label key={u.id} className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1" style={{ borderColor: "var(--border-subtle)" }}>
                    <input type="checkbox" checked={editing.form.userIds.includes(u.id)} onChange={() => setForm({ userIds: toggleIn(editing.form.userIds, u.id) })} />
                    {u.name}{u.plaza ? <span style={{ color: "var(--text-tertiary)" }}> · {PLAZA_LABEL[u.plaza] ?? u.plaza}</span> : null}
                  </label>
                ))}
              </div>
            )}
          </div>

          <ConditionTreeEditor
            tree={editing.form.tree}
            onChange={(tree) => setForm({ tree })}
            label="Aplica cuando"
            emptyText="Sin condiciones = aplica a todos los leads."
            fieldSuggestions={ROUTING_FIELD_SUGGESTIONS}
            listId="routing-field-suggestions"
          />

          <div className="flex gap-2">
            <button className="btn-primary !py-1.5 !px-3 text-[12px]" disabled={saving} onClick={save}>{saving ? "Guardando…" : "Guardar regla"}</button>
            <button className="btn-secondary !py-1.5 !px-3 text-[12px]" onClick={() => setEditing(null)}>Cancelar</button>
          </div>
        </div>
      )}

      {rules.length === 0 && !editing && (
        <p className="px-4 py-6 text-center text-[13px]" style={{ color: "var(--text-tertiary)" }}>
          Sin reglas de ruteo. Todos los leads entran al turno general de asesores.
        </p>
      )}
      {rules.map((r) => (
        <div key={r.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3 hairline-b" style={{ opacity: r.isActive ? 1 : 0.6 }}>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="badge badge-neutral" title="Prioridad">#{r.priority}</span>
              <span className="text-[13px] font-medium">{r.name}</span>
              <span className={`badge ${r.isActive ? "badge-success" : "badge-neutral"}`}>{r.isActive ? "activa" : "inactiva"}</span>
            </div>
            <p className="mt-1 text-[12px]" style={{ color: "var(--text-secondary)" }}>
              <span style={{ color: "var(--text-tertiary)" }}>Cuando </span>{describeConditions(r.conditions)}
              <span style={{ color: "var(--text-tertiary)" }}> → </span>{describeTargets(r.targets as never, usersById)}
              <span style={{ color: "var(--text-tertiary)" }}> · </span>{STRATEGY_LABELS[r.strategy as keyof typeof STRATEGY_LABELS] ?? r.strategy}
            </p>
          </div>
          {canEdit && (
            <div className="flex items-center gap-1">
              <button className="btn-secondary !py-1 !px-2 text-[12px]" title={r.isActive ? "Desactivar" : "Activar"} onClick={() => toggleActive(r)}>
                <Power className="h-3.5 w-3.5" />
              </button>
              <button className="btn-secondary !py-1 !px-2 text-[12px]" title="Editar" onClick={() => setEditing({ id: r.id, form: formFromRule(r) })}>
                <Pencil className="h-3.5 w-3.5" />
              </button>
              {canCreate && (
                <button className="btn-secondary !py-1 !px-2 text-[12px]" title="Eliminar" onClick={() => remove(r)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
