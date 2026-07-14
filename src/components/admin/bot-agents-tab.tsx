"use client";

// Agentes del bot por segmento (Frente 4): identidad + playbook + tono por ContactType.
// El clasificador detecta el tipo de conversación y bot-respond usa el agente del segmento.
import { useState } from "react";
import { Plus, Trash2, Save, Bot } from "lucide-react";
import { upsertAgentProfile, deleteAgentProfile } from "@/server/bot-agents";
import { AGENT_CONTACT_TYPES, AGENT_TONE_PRESETS } from "@/server/bot-agents.schema";

const TYPE_LABEL: Record<string, string> = {
  LEAD: "Lead", PROSPECTO: "Prospecto", CLIENTE: "Cliente", INVERSIONISTA: "Inversionista",
  BROKER_EXTERNO: "Broker externo", REFERIDO: "Referido", EMPLEO: "Empleo",
  COMPRADOR: "Comprador", REFERIDOR: "Referidor",
};
const TONE_LABEL: Record<string, string> = {
  PROFESIONAL_CALIDO: "Profesional cálido", CALIDO_CERCANO_MX: "Cálido cercano MX",
  EJECUTIVO_SOBRIO: "Ejecutivo sobrio", NEUTRO_DIRECTO: "Neutro directo",
};

export interface AgentProfileRow {
  id?: string;
  name: string;
  contactTypes: string[];
  identity: string;
  playbookId: string | null;
  tonePreset: string | null;
  isActive: boolean;
  priority: number;
}

interface Props {
  initialProfiles: AgentProfileRow[];
  playbooks: Array<{ id: string; name: string }>;
}

export function BotAgentsTab({ initialProfiles, playbooks }: Props) {
  const [profiles, setProfiles] = useState<AgentProfileRow[]>(initialProfiles);
  const [savingIdx, setSavingIdx] = useState<number | null>(null);

  function patch(idx: number, p: Partial<AgentProfileRow>) {
    setProfiles((prev) => prev.map((row, i) => (i === idx ? { ...row, ...p } : row)));
  }

  function toggleType(idx: number, type: string) {
    const row = profiles[idx];
    const has = row.contactTypes.includes(type);
    patch(idx, { contactTypes: has ? row.contactTypes.filter((t) => t !== type) : [...row.contactTypes, type] });
  }

  async function save(idx: number) {
    const row = profiles[idx];
    if (!row.name.trim() || !row.identity.trim() || row.contactTypes.length === 0) {
      alert("Completa nombre, identidad y al menos un segmento");
      return;
    }
    setSavingIdx(idx);
    try {
      const saved = await upsertAgentProfile({
        id: row.id,
        name: row.name,
        contactTypes: row.contactTypes as never,
        identity: row.identity,
        playbookId: row.playbookId,
        tonePreset: (row.tonePreset as never) ?? null,
        isActive: row.isActive,
        priority: row.priority,
      });
      patch(idx, { id: saved.id });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setSavingIdx(null);
    }
  }

  async function remove(idx: number) {
    const row = profiles[idx];
    if (row.id) {
      if (!confirm(`¿Eliminar el agente "${row.name}"?`)) return;
      try {
        await deleteAgentProfile(row.id);
      } catch (err) {
        alert(err instanceof Error ? err.message : "Error al eliminar");
        return;
      }
    }
    setProfiles((prev) => prev.filter((_, i) => i !== idx));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[13px]" style={{ color: "var(--text-secondary)" }}>
          El bot clasifica cada conversación nueva (sin pisar lo que ponga un humano) y responde con el agente
          del segmento: su identidad, su playbook y su tono. Sin agente activo para el tipo, usa el flujo global.
        </p>
        <button
          className="btn-secondary !py-1.5 !px-3 text-[12px] shrink-0"
          onClick={() =>
            setProfiles((prev) => [
              ...prev,
              { name: "", contactTypes: [], identity: "", playbookId: null, tonePreset: null, isActive: false, priority: 100 },
            ])
          }
        >
          <Plus className="h-3.5 w-3.5" /> Nuevo agente
        </button>
      </div>

      {profiles.length === 0 && (
        <p className="crm-card !p-6 text-center text-[13px]" style={{ color: "var(--text-tertiary)" }}>
          Sin agentes. Crea uno o corre el seed de la migración.
        </p>
      )}

      {profiles.map((row, idx) => (
        <div key={row.id ?? `new-${idx}`} className="crm-card !p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 shrink-0" style={{ color: "var(--text-tertiary)" }} />
            <input
              className="form-input flex-1 !py-1.5 text-[13px] font-semibold"
              placeholder="Nombre del agente (ej. Agente Brokers)"
              value={row.name}
              onChange={(e) => patch(idx, { name: e.target.value })}
            />
            <label className="flex items-center gap-1.5 text-[12px]" style={{ color: "var(--text-secondary)" }}>
              <input type="checkbox" checked={row.isActive} onChange={(e) => patch(idx, { isActive: e.target.checked })} />
              Activo
            </label>
            <input
              className="form-input w-20 !py-1.5 text-[12px]"
              type="number"
              min={1}
              max={999}
              title="Prioridad (menor gana si un tipo está en dos agentes)"
              value={row.priority}
              onChange={(e) => patch(idx, { priority: Number(e.target.value) || 100 })}
            />
          </div>

          <div className="flex flex-wrap gap-1.5">
            {AGENT_CONTACT_TYPES.map((t) => {
              const on = row.contactTypes.includes(t);
              return (
                <button
                  key={t}
                  onClick={() => toggleType(idx, t)}
                  className="rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors"
                  style={{
                    background: on ? "var(--color-teal)" : "var(--bg-badge-neutral)",
                    color: on ? "var(--text-inverse)" : "var(--text-secondary)",
                  }}
                >
                  {TYPE_LABEL[t] ?? t}
                </button>
              );
            })}
          </div>

          <textarea
            className="form-input w-full resize-none !py-2 text-[13px]"
            rows={3}
            placeholder="Identidad y misión del agente (entra al prompt del bot para este segmento)..."
            value={row.identity}
            onChange={(e) => patch(idx, { identity: e.target.value })}
          />

          <div className="flex flex-wrap items-center gap-2">
            <select
              className="form-input !py-1.5 text-[12px]"
              aria-label="Playbook del agente"
              value={row.playbookId ?? ""}
              onChange={(e) => patch(idx, { playbookId: e.target.value || null })}
            >
              <option value="">Playbook: usar el global activo</option>
              {playbooks.map((pb) => (
                <option key={pb.id} value={pb.id}>Playbook: {pb.name}</option>
              ))}
            </select>
            <select
              className="form-input !py-1.5 text-[12px]"
              aria-label="Tono del agente"
              value={row.tonePreset ?? ""}
              onChange={(e) => patch(idx, { tonePreset: e.target.value || null })}
            >
              <option value="">Tono: usar el global</option>
              {AGENT_TONE_PRESETS.map((t) => (
                <option key={t} value={t}>Tono: {TONE_LABEL[t]}</option>
              ))}
            </select>
            <span className="flex-1" />
            <button className="btn-secondary !py-1.5 !px-2 text-[12px]" title="Eliminar" onClick={() => remove(idx)}>
              <Trash2 className="h-3.5 w-3.5" />
            </button>
            <button className="btn-primary !py-1.5 !px-3 text-[12px]" disabled={savingIdx === idx} onClick={() => save(idx)}>
              <Save className="h-3.5 w-3.5" /> {savingIdx === idx ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
