// Editor visual de políticas SLA por segmento (Task 6): lista + editor inline con
// condiciones de segmento (reusa ConditionTreeEditor) y horario laboral por día/tz.
"use client";

import { useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { ConditionTreeEditor } from "./condition-tree";
import { buildConditionsTree, parseConditions, type ConditionTree } from "@/lib/workflows/builder-model";

export interface Sla {
  id: string;
  name: string;
  isActive: boolean;
  isDefault: boolean;
  priority: number;
  conditions: unknown;
  firstTouchMinutes: number;
  retryMinutes: number;
  orphanHours: number;
  businessHours: unknown;
  _count: { timers: number };
}

interface DayRow {
  open: boolean;
  from: string;
  to: string;
}

const DAY_LABELS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const DEFAULT_TZ = "America/Cancun";

function defaultDays(): DayRow[] {
  return Array.from({ length: 7 }, () => ({ open: false, from: "09:00", to: "18:00" }));
}

function minutesToHHMM(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((x) => Number(x) || 0);
  return h * 60 + m;
}

function parseBusinessHours(bh: unknown): { tz: string; days: DayRow[] } {
  const days = defaultDays();
  if (bh && typeof bh === "object" && "days" in (bh as Record<string, unknown>)) {
    const b = bh as { tz?: string; days?: Record<string, [number, number] | null> };
    for (let i = 0; i <= 6; i++) {
      const v = b.days?.[String(i)];
      if (Array.isArray(v)) days[i] = { open: true, from: minutesToHHMM(v[0]), to: minutesToHHMM(v[1]) };
    }
    return { tz: b.tz && b.tz.length > 0 ? b.tz : DEFAULT_TZ, days };
  }
  return { tz: DEFAULT_TZ, days };
}

function serializeBusinessHours(tz: string, days: DayRow[]): unknown {
  if (!days.some((d) => d.open)) return {};
  const daysObj: Record<string, [number, number] | null> = {};
  days.forEach((d, i) => {
    daysObj[String(i)] = d.open ? [hhmmToMinutes(d.from), hhmmToMinutes(d.to)] : null;
  });
  return { tz: tz.trim() || DEFAULT_TZ, days: daysObj };
}

function extractError(d: any): string {
  if (typeof d?.error === "string") return d.error;
  if (Array.isArray(d?.error?.formErrors) && d.error.formErrors.length) return d.error.formErrors.join(", ");
  if (d?.error?.fieldErrors) {
    const msgs = Object.entries(d.error.fieldErrors as Record<string, string[]>).flatMap(([k, v]) =>
      (v ?? []).map((m) => `${k}: ${m}`)
    );
    if (msgs.length) return msgs.join("; ");
  }
  return "Error al guardar";
}

// Switch local (mismo patrón visual que el de automation-section.tsx).
function Switch({ on, disabled, onChange }: { on: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!on)}
      className="relative h-5 w-9 rounded-full transition-colors disabled:opacity-40"
      style={{ background: on ? "var(--color-success)" : "var(--bg-badge-neutral)" }}
      title={on ? "Activa — clic para pausar" : "Inactiva — clic para activar"}
    >
      <span
        className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all"
        style={{ left: on ? "18px" : "2px", boxShadow: "0 1px 2px rgba(0,0,0,.2)" }}
      />
    </button>
  );
}

function SlaForm({
  initial,
  onSaved,
  onCancel,
}: {
  initial?: Sla;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const bh = parseBusinessHours(initial?.businessHours);
  const [name, setName] = useState(initial?.name ?? "");
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [isDefault, setIsDefault] = useState(initial?.isDefault ?? false);
  const [priority, setPriority] = useState(initial?.priority ?? 100);
  const [firstTouchMinutes, setFirstTouchMinutes] = useState(initial?.firstTouchMinutes ?? 15);
  const [retryMinutes, setRetryMinutes] = useState(initial?.retryMinutes ?? 60);
  const [orphanHours, setOrphanHours] = useState(initial?.orphanHours ?? 24);
  const [tz, setTz] = useState(bh.tz);
  const [days, setDays] = useState<DayRow[]>(bh.days);
  const [tree, setTree] = useState<ConditionTree>(parseConditions(initial?.conditions));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function updateDay(i: number, patch: Partial<DayRow>) {
    setDays((d) => d.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }

  async function save() {
    setErr(null);
    if (!name.trim()) {
      setErr("El nombre es obligatorio");
      return;
    }
    for (let i = 0; i < days.length; i++) {
      const d = days[i];
      if (d.open && hhmmToMinutes(d.from) >= hhmmToMinutes(d.to)) {
        setErr(`En ${DAY_LABELS[i]}, la apertura debe ser antes que el cierre`);
        return;
      }
    }
    setBusy(true);
    const body = {
      name: name.trim(),
      isActive,
      isDefault,
      priority,
      conditions: isDefault ? {} : buildConditionsTree(tree),
      firstTouchMinutes,
      retryMinutes,
      orphanHours,
      businessHours: serializeBusinessHours(tz, days),
    };
    const url = initial ? `/api/admin/automation/sla/${initial.id}` : "/api/admin/automation/sla";
    const res = await fetch(url, {
      method: initial ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setErr(extractError(d));
      return;
    }
    onSaved();
  }

  return (
    <div className="space-y-4 rounded-lg border p-5" style={{ borderColor: "var(--border-subtle)", background: "var(--bg-card)" }}>
      {/* Identidad */}
      <div className="space-y-1">
        <label className="text-[11px] uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>
          Nombre de la política
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="ej. Leads VIP"
          className="form-input text-[13px] font-medium"
        />
      </div>

      <div className="flex flex-wrap items-center gap-5">
        <label className="flex items-center gap-2 text-[13px]" style={{ color: "var(--text-secondary)" }}>
          <span>Activa</span>
          <Switch on={isActive} onChange={setIsActive} />
        </label>
        <label className="flex items-center gap-2 text-[13px]" style={{ color: "var(--text-secondary)" }}>
          <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
          Es la política default
        </label>
        <label className="flex items-center gap-2 text-[13px]" style={{ color: "var(--text-secondary)" }}>
          Prioridad
          <input
            type="number"
            min={0}
            max={1000}
            value={priority}
            onChange={(e) => setPriority(Number(e.target.value))}
            className="form-input !w-20 !py-1 num"
          />
        </label>
      </div>

      {/* Segmento (condiciones) */}
      {!isDefault ? (
        <ConditionTreeEditor
          tree={tree}
          onChange={setTree}
          label="Segmento (condiciones)"
          emptyText="Sin condiciones = aplica a cualquier contacto que no calce con una política de mayor prioridad."
        />
      ) : (
        <p className="rounded-md border p-3 text-[12px]" style={{ borderColor: "var(--border-subtle)", color: "var(--text-tertiary)" }}>
          La política default aplica cuando ningún segmento cumple.
        </p>
      )}

      {/* Tiempos */}
      <div className="flex flex-wrap gap-4">
        <label className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
          1er toque (min)
          <input
            type="number"
            min={1}
            max={1440}
            value={firstTouchMinutes}
            onChange={(e) => setFirstTouchMinutes(Number(e.target.value))}
            className="form-input mt-1 !w-24 !py-1 num"
          />
        </label>
        <label className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
          Reintento (min)
          <input
            type="number"
            min={1}
            max={1440}
            value={retryMinutes}
            onChange={(e) => setRetryMinutes(Number(e.target.value))}
            className="form-input mt-1 !w-24 !py-1 num"
          />
        </label>
        <label className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
          Huérfano (hrs)
          <input
            type="number"
            min={1}
            max={720}
            value={orphanHours}
            onChange={(e) => setOrphanHours(Number(e.target.value))}
            className="form-input mt-1 !w-24 !py-1 num"
          />
        </label>
      </div>

      {/* Horario laboral */}
      <div className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>
          Horario laboral
        </p>
        <label className="block text-[11px]" style={{ color: "var(--text-secondary)" }}>
          Zona horaria
          <input
            value={tz}
            onChange={(e) => setTz(e.target.value)}
            placeholder={DEFAULT_TZ}
            className="form-input mt-1 !w-56 text-[13px]"
          />
        </label>
        <div className="space-y-1.5">
          {days.map((d, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 text-[13px]">
              <label className="flex w-20 shrink-0 items-center gap-2" style={{ color: "var(--text-secondary)" }}>
                <input type="checkbox" checked={d.open} onChange={(e) => updateDay(i, { open: e.target.checked })} />
                {DAY_LABELS[i]}
              </label>
              <input
                type="time"
                value={d.from}
                disabled={!d.open}
                onChange={(e) => updateDay(i, { from: e.target.value })}
                className="form-input !w-28 !py-1 num"
              />
              <span style={{ color: "var(--text-tertiary)" }}>—</span>
              <input
                type="time"
                value={d.to}
                disabled={!d.open}
                onChange={(e) => updateDay(i, { to: e.target.value })}
                className="form-input !w-28 !py-1 num"
              />
            </div>
          ))}
        </div>
        <p className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
          Ningún día marcado como abierto = se evalúa en reloj de pared, 24/7.
        </p>
      </div>

      {/* Error + acciones */}
      {err && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">{err}</p>
      )}
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} className="btn-secondary text-[13px]" disabled={busy}>
          Cancelar
        </button>
        <button type="button" disabled={busy || !name.trim()} onClick={save} className="btn-primary text-[13px]">
          {busy ? "Guardando…" : initial ? "Actualizar política" : "Crear política"}
        </button>
      </div>
    </div>
  );
}

export function SlaPolicyEditor({
  policies,
  canEdit,
  onChanged,
}: {
  policies: Sla[];
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<"new" | Sla | null>(null);
  const [msg, setMsg] = useState("");

  async function handleDelete(s: Sla) {
    if (s.isDefault) return;
    if (!confirm(`¿Eliminar la política "${s.name}"? Los timers históricos quedarán sin política asociada.`)) return;
    setMsg("");
    const res = await fetch(`/api/admin/automation/sla/${s.id}`, { method: "DELETE" });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setMsg(extractError(d));
      return;
    }
    onChanged();
  }

  return (
    <div className="crm-card !p-0 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 hairline-b">
        <div>
          <p className="text-[13px] font-semibold">Políticas SLA (speed-to-lead)</p>
          <p className="text-[12px]" style={{ color: "var(--text-tertiary)" }}>
            Tiempos de respuesta por segmento, con horario laboral opcional
          </p>
        </div>
        {canEdit && (
          <button className="btn-primary shrink-0 text-[12px]" onClick={() => setEditing("new")}>
            <Plus className="h-3.5 w-3.5" /> Nueva política
          </button>
        )}
      </div>

      {msg && (
        <p className="px-4 pt-3 text-[12px]" style={{ color: "var(--color-error)" }}>{msg}</p>
      )}

      {editing && (
        <div className="px-4 py-4 hairline-b">
          <SlaForm
            initial={editing === "new" ? undefined : editing}
            onSaved={() => { setEditing(null); onChanged(); }}
            onCancel={() => setEditing(null)}
          />
        </div>
      )}

      {policies.length === 0 && !editing && (
        <p className="px-4 py-6 text-center text-[12px]" style={{ color: "var(--text-tertiary)" }}>
          Sin políticas SLA todavía.
        </p>
      )}

      {policies.map((s) => (
        <div key={s.id} className="flex items-center justify-between gap-3 px-4 py-3 hairline-b">
          <div className="min-w-0">
            <p className="text-[13px] font-medium">
              {s.name}
              {s.isDefault && <span className="badge badge-neutral ml-1">default</span>}
              {!s.isActive && <span className="badge badge-neutral ml-1">inactiva</span>}
            </p>
            <p className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
              prioridad {s.priority} · {s._count.timers} timers históricos
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: s.isActive ? "var(--color-success)" : "var(--bg-badge-neutral)" }}
              title={s.isActive ? "Activa" : "Inactiva"}
            />
            {canEdit && (
              <>
                <button
                  onClick={() => setEditing(s)}
                  className="text-[color:var(--text-tertiary)] hover:text-[color:var(--text-primary)]"
                  title="Editar política"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  onClick={() => handleDelete(s)}
                  disabled={s.isDefault}
                  className="text-[color:var(--text-tertiary)] hover:text-red-600 disabled:opacity-30"
                  title={s.isDefault ? "No se puede borrar la política default" : "Eliminar política"}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
