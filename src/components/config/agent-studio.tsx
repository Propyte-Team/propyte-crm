// Agent Studio (Fase 7, T7.2): crear/editar un agente IA — identidad RBAC, goal,
// tools permitidas, autonomía, trigger, límites. El runner ya existe (Claude tool-use).
"use client";

import { useState, useEffect } from "react";

interface Tool { name: string; description: string }
interface Props {
  agent?: any;
  availableTools: Tool[];
  onSaved: () => void;
  onCancel: () => void;
}

const AUTONOMY = [
  { value: "L0", label: "L0 · Solo sugiere" },
  { value: "L1", label: "L1 · Prepara, requiere aprobación" },
  { value: "L2", label: "L2 · Autónomo con red (FAQ/agenda/primer toque)" },
];

export function AgentStudio({ agent, availableTools, onSaved, onCancel }: Props) {
  const isEdit = !!agent;
  const [name, setName] = useState(agent?.name ?? "");
  const [goal, setGoal] = useState(agent?.goal ?? "");
  const [systemUserId, setSystemUserId] = useState(agent?.systemUserId ?? agent?.systemUser?.id ?? "");
  const [autonomyLevel, setAutonomyLevel] = useState(agent?.autonomyLevel ?? "L2");
  const [tools, setTools] = useState<string[]>(agent?.allowedTools ?? []);
  const [triggerEvent, setTriggerEvent] = useState<string>(agent?.trigger?.eventType ?? "");
  const [maxPerDay, setMaxPerDay] = useState<string>(agent?.limits?.maxPerDay ? String(agent.limits.maxPerDay) : "");
  const [users, setUsers] = useState<Array<{ id: string; name: string; role: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/users").then((r) => (r.ok ? r.json() : { data: [] })).then((j) => setUsers(j.data ?? [])).catch(() => setUsers([]));
  }, []);

  function toggleTool(t: string) {
    setTools((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  }

  async function save(activate: boolean) {
    setError(null);
    if (name.trim().length < 2) { setError("Nombre muy corto."); return; }
    if (goal.trim().length < 10) { setError("El objetivo debe tener al menos 10 caracteres."); return; }
    if (!systemUserId) { setError("Selecciona la identidad (usuario sistema) del agente."); return; }
    if (tools.length === 0) { setError("Selecciona al menos una herramienta."); return; }
    setSaving(true);
    const payload: Record<string, unknown> = {
      ...(isEdit ? { id: agent.id } : {}),
      name: name.trim(),
      goal: goal.trim(),
      systemUserId,
      autonomyLevel,
      allowedTools: tools,
      trigger: triggerEvent ? { eventType: triggerEvent } : {},
      limits: maxPerDay ? { maxPerDay: Number(maxPerDay) } : {},
      isActive: activate,
    };
    const res = await fetch("/api/admin/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    if (res.ok) onSaved();
    else {
      const d = await res.json().catch(() => ({}));
      setError(typeof d.error === "string" ? d.error : "No se pudo guardar el agente");
    }
  }

  return (
    <div className="space-y-4">
      {error && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <Field label="Nombre">
        <input className="form-input text-[13px]" value={name} onChange={(e) => setName(e.target.value)} placeholder="ej. SDR Speed-to-lead" />
      </Field>
      <Field label="Objetivo / prompt (qué hace y con qué voz)">
        <textarea className="form-input min-h-[90px] text-[13px]" value={goal} onChange={(e) => setGoal(e.target.value)}
          placeholder="Califica leads nuevos por WhatsApp con voz Sage; agenda visita; escala a humano ante intención de compra o queja." />
      </Field>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="Identidad (usuario sistema · RBAC)">
          <select className="form-input text-[13px]" value={systemUserId} onChange={(e) => setSystemUserId(e.target.value)}>
            <option value="">Selecciona…</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
          </select>
        </Field>
        <Field label="Autonomía">
          <select className="form-input text-[13px]" value={autonomyLevel} onChange={(e) => setAutonomyLevel(e.target.value)}>
            {AUTONOMY.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
        </Field>
      </div>

      <Field label="Herramientas permitidas">
        <div className="grid grid-cols-1 gap-1.5 rounded-md border p-3 md:grid-cols-2" style={{ borderColor: "var(--border-subtle)" }}>
          {availableTools.map((t) => (
            <label key={t.name} className="flex items-start gap-2 text-[12px]">
              <input type="checkbox" className="mt-0.5" checked={tools.includes(t.name)} onChange={() => toggleTool(t.name)} />
              <span>
                <span className="num font-medium">{t.name}</span>
                <span className="block text-[11px]" style={{ color: "var(--text-tertiary)" }}>{t.description}</span>
              </span>
            </label>
          ))}
          {availableTools.length === 0 && <p className="text-[12px]" style={{ color: "var(--text-tertiary)" }}>Sin tools disponibles.</p>}
        </div>
      </Field>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="Trigger — evento (opcional)">
          <input className="form-input text-[13px]" value={triggerEvent} onChange={(e) => setTriggerEvent(e.target.value)} placeholder="ej. lead.captured" />
        </Field>
        <Field label="Límite de corridas/día (opcional)">
          <input className="form-input text-[13px]" type="number" value={maxPerDay} onChange={(e) => setMaxPerDay(e.target.value)} placeholder="ej. 100" />
        </Field>
      </div>

      <p className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
        Requiere ANTHROPIC_API_KEY en el servidor para ejecutar. Las corridas quedan auditadas (AgentRun).
      </p>

      <div className="flex justify-end gap-2 pt-2">
        <button className="btn-secondary text-[13px]" onClick={onCancel} disabled={saving}>Cancelar</button>
        <button className="btn-secondary text-[13px]" onClick={() => save(false)} disabled={saving}>Guardar pausado</button>
        <button className="btn-primary text-[13px]" onClick={() => save(true)} disabled={saving}>
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
