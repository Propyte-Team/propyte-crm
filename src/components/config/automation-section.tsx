// Configuración → Automatización: workflows con switch, cadencias, SLA editable, cola.
"use client";

import { useState, useEffect, useCallback } from "react";
import { Save } from "lucide-react";

interface Rule {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  triggerType: string;
  lastFiredAt: string | null;
  actions: unknown[];
}
interface Plan {
  id: string;
  name: string;
  isActive: boolean;
  ownerUserId: string | null;
  steps: Array<{ order: number; actionType: string; delayMinutes: number }>;
  _count: { enrollments: number };
}
interface Sla {
  id: string;
  name: string;
  isDefault: boolean;
  firstTouchMinutes: number;
  retryMinutes: number;
  orphanHours: number;
  _count: { timers: number };
}

function Switch({ on, disabled, onChange }: { on: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      disabled={disabled}
      onClick={() => onChange(!on)}
      className="relative h-5 w-9 rounded-full transition-colors disabled:opacity-40"
      style={{ background: on ? "var(--color-success)" : "var(--bg-badge-neutral)" }}
      title={on ? "Activo — clic para pausar" : "Inactivo — clic para activar"}
    >
      <span
        className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all"
        style={{ left: on ? "18px" : "2px", boxShadow: "0 1px 2px rgba(0,0,0,.2)" }}
      />
    </button>
  );
}

export function AutomationSection({ userRole }: { userRole: string }) {
  const canEdit = ["ADMIN", "DIRECTOR"].includes(userRole);
  const [rules, setRules] = useState<Rule[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [slas, setSlas] = useState<Sla[]>([]);
  const [queue, setQueue] = useState<Record<string, number>>({});
  const [slaDraft, setSlaDraft] = useState<Record<string, Partial<Sla>>>({});
  const [msg, setMsg] = useState("");
  const [obs, setObs] = useState<{ recentErrors: any[]; eventsPending: number; eventsDone24h: number }>({ recentErrors: [], eventsPending: 0, eventsDone24h: 0 });

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/automation");
    if (res.ok) {
      const { data } = await res.json();
      setRules(data.rules ?? []);
      setPlans(data.plans ?? []);
      setSlas(data.slaPolicies ?? []);
      setQueue(data.queue ?? {});
      setObs(data.observability ?? { recentErrors: [], eventsPending: 0, eventsDone24h: 0 });
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function retry(id: string) {
    const res = await fetch("/api/admin/automation/retry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setMsg(res.ok ? "Acción re-encolada ✓" : "No se pudo reintentar");
    load();
  }

  async function patch(body: Record<string, unknown>) {
    setMsg("");
    const res = await fetch("/api/admin/automation", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) setMsg("Error al guardar");
    load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Flujos de trabajo y SLA</h1>
        <p className="text-muted-foreground">
          Cola de acciones: {Object.entries(queue).map(([k, v]) => `${k} ${v}`).join(" · ") || "vacía"}
        </p>
      </div>
      {msg && <p className="text-[13px]" style={{ color: "var(--color-error)" }}>{msg}</p>}

      {/* Observabilidad (T4.1) */}
      <div className="crm-card !p-0 overflow-hidden">
        <div className="px-4 py-3 hairline-b flex items-center justify-between">
          <span className="text-[13px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
            Observabilidad del motor
          </span>
          <button onClick={load} className="text-[12px] hover:underline" style={{ color: "var(--text-tertiary)" }}>Actualizar</button>
        </div>
        <div className="grid grid-cols-2 gap-px md:grid-cols-4" style={{ background: "var(--border-subtle)" }}>
          <div className="px-4 py-3" style={{ background: "var(--bg-card)" }}>
            <p className="text-[11px] uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>Eventos pendientes</p>
            <p className="num mt-0.5 text-[15px] font-medium" style={{ color: obs.eventsPending > 0 ? "var(--color-error)" : "var(--text-primary)" }}>{obs.eventsPending}</p>
          </div>
          <div className="px-4 py-3" style={{ background: "var(--bg-card)" }}>
            <p className="text-[11px] uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>Procesados (24h)</p>
            <p className="num mt-0.5 text-[15px] font-medium">{obs.eventsDone24h}</p>
          </div>
          <div className="px-4 py-3" style={{ background: "var(--bg-card)" }}>
            <p className="text-[11px] uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>En cola</p>
            <p className="num mt-0.5 text-[15px] font-medium">{(queue.PENDING ?? 0) + (queue.RUNNING ?? 0)}</p>
          </div>
          <div className="px-4 py-3" style={{ background: "var(--bg-card)" }}>
            <p className="text-[11px] uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>Fallidas</p>
            <p className="num mt-0.5 text-[15px] font-medium" style={{ color: (queue.FAILED ?? 0) > 0 ? "var(--color-error)" : "var(--text-primary)" }}>{queue.FAILED ?? 0}</p>
          </div>
        </div>
        {obs.recentErrors.length > 0 && (
          <div style={{ borderTop: "1px solid var(--border-subtle)" }}>
            <p className="px-4 pt-3 text-[11px] uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>Errores recientes</p>
            <ul className="divide-y" style={{ borderColor: "var(--border-subtle)" }}>
              {obs.recentErrors.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-3 px-4 py-2">
                  <div className="min-w-0">
                    <p className="text-[13px]">{e.actionType} <span style={{ color: "var(--text-tertiary)" }}>· {e.entityType}</span></p>
                    <p className="truncate text-[11px]" style={{ color: "var(--color-error)" }}>{e.error ?? "—"} ({e.attempts}/{e.maxAttempts})</p>
                  </div>
                  {canEdit && (
                    <button onClick={() => retry(e.id)} className="btn-secondary shrink-0 text-[12px]">Reintentar</button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {obs.eventsPending === 0 && (queue.FAILED ?? 0) === 0 && obs.recentErrors.length === 0 && (
          <p className="px-4 py-3 text-[12px]" style={{ color: "var(--text-tertiary)" }}>
            Motor al día: sin eventos pendientes ni acciones fallidas. (Requiere el cron `/api/cron/workflows` activo.)
          </p>
        )}
      </div>

      {/* Workflows */}
      <div className="crm-card !p-0 overflow-hidden">
        <div className="px-4 py-3 hairline-b">
          <p className="text-[13px] font-semibold">Reglas de flujo de trabajo</p>
          <p className="text-[12px]" style={{ color: "var(--text-tertiary)" }}>
            Requieren el cron /api/cron/workflows activo en Hostinger para ejecutarse
          </p>
        </div>
        {rules.map((r) => (
          <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-3 hairline-b">
            <div className="min-w-0">
              <p className="text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>{r.name}</p>
              <p className="truncate text-[12px]" style={{ color: "var(--text-secondary)" }}>
                {r.description ?? "—"}
              </p>
              <p className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                {r.triggerType} · {Array.isArray(r.actions) ? r.actions.length : 0} acciones ·
                última: {r.lastFiredAt ? new Date(r.lastFiredAt).toLocaleString("es-MX") : "nunca"}
              </p>
            </div>
            <Switch on={r.isActive} disabled={!canEdit} onChange={(v) => patch({ kind: "rule", id: r.id, isActive: v })} />
          </div>
        ))}
      </div>

      {/* Cadencias */}
      <div className="crm-card !p-0 overflow-hidden">
        <div className="px-4 py-3 hairline-b">
          <p className="text-[13px] font-semibold">Cadencias (action plans)</p>
        </div>
        {plans.length === 0 && (
          <p className="px-4 py-6 text-center text-[13px]" style={{ color: "var(--text-tertiary)" }}>
            Sin cadencias. Se crean desde la API o el builder (próxima fase).
          </p>
        )}
        {plans.map((p) => (
          <div key={p.id} className="flex items-center justify-between gap-3 px-4 py-3 hairline-b">
            <div className="min-w-0">
              <p className="text-[13px] font-medium">{p.name} {p.ownerUserId && <span className="badge badge-neutral ml-1">personal</span>}</p>
              <p className="text-[12px]" style={{ color: "var(--text-secondary)" }}>
                {p.steps.length} pasos · {p._count.enrollments} enrolados
              </p>
            </div>
            <Switch on={p.isActive} disabled={!canEdit} onChange={(v) => patch({ kind: "plan", id: p.id, isActive: v })} />
          </div>
        ))}
      </div>

      {/* SLA */}
      <div className="crm-card !p-0 overflow-hidden">
        <div className="px-4 py-3 hairline-b">
          <p className="text-[13px] font-semibold">Políticas SLA (speed-to-lead)</p>
        </div>
        {slas.map((s) => {
          const draft = slaDraft[s.id] ?? {};
          const dirty = Object.keys(draft).length > 0;
          return (
            <div key={s.id} className="flex flex-wrap items-end gap-4 px-4 py-3 hairline-b">
              <div className="min-w-[140px]">
                <p className="text-[13px] font-medium">{s.name} {s.isDefault && <span className="badge badge-neutral ml-1">default</span>}</p>
                <p className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>{s._count.timers} timers históricos</p>
              </div>
              {(["firstTouchMinutes", "retryMinutes", "orphanHours"] as const).map((f) => (
                <label key={f} className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
                  {f === "firstTouchMinutes" ? "1er toque (min)" : f === "retryMinutes" ? "Reintento (min)" : "Huérfano (hrs)"}
                  <input
                    type="number"
                    className="form-input mt-1 !w-24 !py-1 num"
                    disabled={!canEdit}
                    value={(draft[f] ?? s[f]) as number}
                    onChange={(e) => setSlaDraft({ ...slaDraft, [s.id]: { ...draft, [f]: Number(e.target.value) } })}
                  />
                </label>
              ))}
              <button
                className="btn-primary !py-1.5 !px-3 text-[12px]"
                disabled={!canEdit || !dirty}
                onClick={async () => {
                  await patch({ kind: "sla", id: s.id, ...draft });
                  setSlaDraft({ ...slaDraft, [s.id]: {} });
                }}
              >
                <Save className="h-3.5 w-3.5" /> Guardar
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
