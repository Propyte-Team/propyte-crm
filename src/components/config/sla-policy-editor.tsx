// Editor visual de políticas SLA por segmento (Task 6): lista + editor inline con
// condiciones de segmento (reusa ConditionTreeEditor) y horario laboral por día/tz.
"use client";

import { useState, useEffect, useRef } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { ConditionTreeEditor } from "./condition-tree";
import { parseConditions, type ConditionTree } from "@/lib/workflows/builder-model";
import { buildConditionsTreeGuiado } from "./condition-tree-model";
import { erroresPorCampo } from "@/lib/api-errors";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/use-toast";
import { formatMinutes, mensajeAutomatizacion } from "./cadence-editor";

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

function extractError(d: unknown): string {
  return mensajeAutomatizacion(d, "No se pudo guardar la política");
}

/** Línea-resumen de tiempos: "Contactar en 15 min · recordar cada 1 h · reasignar a las 24 h". */
export function slaSummary(firstTouchMinutes: number, retryMinutes: number, orphanHours: number): string {
  return `Contactar en ${formatMinutes(firstTouchMinutes)} · recordar cada ${formatMinutes(retryMinutes)} · reasignar a las ${orphanHours} h`;
}

// Zonas horarias de México más usadas (el valor guardado sigue siendo el nombre IANA).
const TZ_OPTIONS: { value: string; label: string }[] = [
  { value: "America/Cancun", label: "Cancún / Tulum (sin horario de verano)" },
  { value: "America/Mexico_City", label: "Ciudad de México" },
  { value: "America/Monterrey", label: "Monterrey" },
  { value: "America/Tijuana", label: "Tijuana" },
];

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
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});

  function updateDay(i: number, patch: Partial<DayRow>) {
    setDays((d) => d.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }

  async function save() {
    setErr(null);
    setFieldErrs({});
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
      conditions: isDefault ? {} : buildConditionsTreeGuiado(tree),
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
      setFieldErrs(erroresPorCampo(d));
      setErr(extractError(d));
      return;
    }
    toast({ title: initial ? "Política actualizada" : "Política creada" });
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
        {fieldErrs.name && <p className="text-[11px] text-red-600">{fieldErrs.name}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-5">
        <label className="flex items-center gap-2 text-[13px]" style={{ color: "var(--text-secondary)" }}>
          <span>Activa</span>
          <Switch on={isActive} onChange={setIsActive} />
        </label>
        <label className="flex items-center gap-2 text-[13px]" style={{ color: "var(--text-secondary)" }}>
          <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
          Aplica a todos los demás contactos (política general)
        </label>
        <label className="flex items-center gap-2 text-[13px]" style={{ color: "var(--text-secondary)" }} title="Si un contacto cumple varias políticas, gana la de número menor">
          Orden (menor = primero)
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
          label="¿Para qué contactos aplica? (segmento)"
          contexto="contact"
          emptyText="Sin condiciones = aplica a cualquier contacto que no cumpla otra política de orden menor."
        />
      ) : (
        <p className="rounded-md border p-3 text-[12px]" style={{ borderColor: "var(--border-subtle)", color: "var(--text-tertiary)" }}>
          La política general aplica a los contactos que no cumplen ningún segmento.
        </p>
      )}

      {/* Tiempos */}
      <div className="flex flex-wrap gap-4">
        <label className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
          Contactar en (min)
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
          Recordar cada (min)
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
          Reasignar si nadie lo toma (hrs)
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

      <p className="text-[12px]" style={{ color: "var(--text-secondary)" }}>
        <strong>Así funciona:</strong> {slaSummary(firstTouchMinutes, retryMinutes, orphanHours)}.
        Si el asesor no hace el primer contacto a tiempo se le recuerda; si el lead sigue sin asesor, se reasigna.
      </p>

      {/* Horario laboral */}
      <div className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>
          Horario laboral
        </p>
        <label className="block text-[11px]" style={{ color: "var(--text-secondary)" }}>
          Zona horaria
          <select
            value={tz}
            onChange={(e) => setTz(e.target.value)}
            className="form-input mt-1 !w-72 text-[13px]"
          >
            {[...TZ_OPTIONS, ...(TZ_OPTIONS.some((o) => o.value === tz) ? [] : [{ value: tz, label: tz }])].map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
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
          Ningún día marcado = el reloj corre las 24 horas, todos los días.
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
  deepLinkSlaId,
}: {
  policies: Sla[];
  canEdit: boolean;
  onChanged: () => void;
  /** Deep-link desde el panel SLA del Journey → abre esta política directo, una vez. */
  deepLinkSlaId?: string;
}) {
  const [editing, setEditing] = useState<"new" | Sla | null>(null);
  const [msg, setMsg] = useState("");
  const confirmar = useConfirm();
  const appliedDeepLink = useRef(false);

  useEffect(() => {
    if (appliedDeepLink.current || !deepLinkSlaId || policies.length === 0) return;
    appliedDeepLink.current = true;
    const match = policies.find((p) => p.id === deepLinkSlaId);
    if (match) setEditing(match);
  }, [deepLinkSlaId, policies]);

  async function handleDelete(s: Sla) {
    if (s.isDefault) return;
    const ok = await confirmar({
      titulo: `¿Eliminar la política "${s.name}"?`,
      descripcion: "Las métricas pasadas se conservan.",
      confirmar: "Eliminar",
      peligroso: true,
    });
    if (!ok) return;
    setMsg("");
    const res = await fetch(`/api/admin/automation/sla/${s.id}`, { method: "DELETE" });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setMsg(extractError(d));
      return;
    }
    toast({ title: "Política eliminada" });
    onChanged();
  }

  return (
    <div className="crm-card !p-0 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 hairline-b">
        <div>
          <p className="text-[13px] font-semibold">Tiempos de respuesta (SLA)</p>
          <p className="text-[12px]" style={{ color: "var(--text-tertiary)" }}>
            Cuánto puede tardar el primer contacto con un lead nuevo, por segmento y con horario laboral opcional
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
          Sin políticas de tiempo de respuesta todavía.
        </p>
      )}

      {policies.map((s) => (
        <div key={s.id} className="flex items-center justify-between gap-3 px-4 py-3 hairline-b">
          <div className="min-w-0">
            <p className="text-[13px] font-medium">
              {s.name}
              {s.isDefault && <span className="badge badge-neutral ml-1">general</span>}
              {!s.isActive && <span className="badge badge-neutral ml-1">inactiva</span>}
            </p>
            <p className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
              {slaSummary(s.firstTouchMinutes, s.retryMinutes, s.orphanHours)}
            </p>
            <p className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
              Orden {s.priority} · {s._count.timers} seguimientos registrados
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
