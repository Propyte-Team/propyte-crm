"use client";

// Agentes del bot por tipo de contacto (Frente 4): presentación + playbook + estilo por ContactType.
// El bot detecta el tipo de conversación y bot-respond usa el agente de ese tipo.
import { useState } from "react";
import { Plus, Trash2, Save, Bot } from "lucide-react";
import { upsertAgentProfile, deleteAgentProfile } from "@/server/bot-agents";
import { AGENT_CONTACT_TYPES, AGENT_TONE_PRESETS, tiposDeAgenteVigentes } from "@/server/bot-agents.schema";
import { CONTACT_TYPE_LABELS } from "@/lib/constants";
import { TONE_PRESETS } from "@/lib/bot/tone-presets";
import { useToast } from "@/components/ui/use-toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { mensajeDeError } from "@/lib/api-errors";
import { BotResumen } from "./bot-resumen";
import { useBotGeneral } from "./use-bot-general";
import { textoHereda } from "@/lib/bot/quien-contesta";
import { textoUsadoPor, usoDeGuiones } from "@/lib/bot/uso-de-guiones";

// #907: mismas etiquetas que el resto del CRM («Broker», «Proveedor», «Otro»…).
const TYPE_LABEL: Record<string, string> = CONTACT_TYPE_LABELS;
// Mismas etiquetas que la pestaña Bot (antes decía "Cálido cercano MX" aquí y "Cálido-cercano (MX)" allá).
const TONE_LABEL: Record<string, string> = Object.fromEntries(
  Object.entries(TONE_PRESETS).map(([k, v]) => [k, v.label]),
);

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
  // #956: los tipos se muestran ya traducidos a los vigentes. Antes un tipo retirado (Lead,
  // Comprador, Inversionista, Referidor) quedaba invisible en el arreglo y tumbaba el guardado.
  const [profiles, setProfiles] = useState<AgentProfileRow[]>(() =>
    initialProfiles.map((p) => ({ ...p, contactTypes: tiposDeAgenteVigentes(p.contactTypes) })),
  );
  const [savingIdx, setSavingIdx] = useState<number | null>(null);
  const { toast } = useToast();
  const confirmar = useConfirm();
  const { datos: general } = useBotGeneral();
  // «usado por»: lo guardado en el servidor (bot general, marcas y agentes que ya eligieron cada guion).
  const usoGuiones = general ? usoDeGuiones(general) : null;

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
      toast({
        title: "Faltan datos del agente",
        description: "Completa el nombre, cómo se presenta y al menos un tipo de contacto.",
        variant: "destructive",
      });
      return;
    }
    setSavingIdx(idx);
    try {
      const res = await upsertAgentProfile({
        id: row.id,
        name: row.name,
        contactTypes: row.contactTypes as never,
        identity: row.identity,
        playbookId: row.playbookId,
        tonePreset: (row.tonePreset as never) ?? null,
        isActive: row.isActive,
        priority: row.priority,
      });
      if (!res.ok) {
        toast({ title: "No se pudo guardar el agente", description: mensajeDeError({ error: res.error }), variant: "destructive" });
        return;
      }
      patch(idx, { id: res.profile.id });
      toast({ title: "Agente guardado" });
    } catch (err) {
      toast({
        title: "No se pudo guardar el agente",
        description: err instanceof Error && err.message ? err.message : "Intenta de nuevo; si sigue fallando, avisa a sistemas.",
        variant: "destructive",
      });
    } finally {
      setSavingIdx(null);
    }
  }

  async function remove(idx: number) {
    const row = profiles[idx];
    if (row.id) {
      const ok = await confirmar({
        titulo: `¿Eliminar el agente "${row.name || "sin nombre"}"?`,
        descripcion: "Los contactos de ese tipo dejarán de usar este agente y el bot responderá con la configuración general. No se puede deshacer.",
        confirmar: "Eliminar agente",
        peligroso: true,
      });
      if (!ok) return;
      try {
        await deleteAgentProfile(row.id);
      } catch (err) {
        toast({
          title: "No se pudo eliminar el agente",
          description: err instanceof Error && err.message ? err.message : "Intenta de nuevo.",
          variant: "destructive",
        });
        return;
      }
      toast({ title: "Agente eliminado" });
    }
    setProfiles((prev) => prev.filter((_, i) => i !== idx));
  }

  // Lo que se ve en pantalla (aunque no esté guardado) alimenta el resumen "¿Quién contesta?".
  const agentesEnPantalla = profiles
    .filter((p) => p.id)
    .map((p) => ({
      id: p.id as string,
      name: p.name,
      contactTypes: p.contactTypes,
      tonePreset: p.tonePreset,
      playbookId: p.playbookId,
      isActive: p.isActive,
      priority: p.priority,
    }));

  return (
    <div className="space-y-4">
      <BotResumen agentes={agentesEnPantalla} />
      <div className="flex items-center justify-between">
        <p className="text-[13px]" style={{ color: "var(--text-secondary)" }}>
          El bot detecta si escribe un comprador, un broker o un candidato (sin pisar lo que ponga un humano) y
          contesta con el agente de ese tipo: cómo se presenta, qué preguntas hace y su estilo. Si no hay un
          agente activo para ese tipo, usa la configuración general del bot.
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
          Aún no hay agentes. Crea el primero con «Nuevo agente».
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
            aria-label="Cómo se presenta y qué busca el agente"
            placeholder="Cómo se presenta el agente y qué busca lograr con estos contactos. Ej.: «Eres Sage, asesora de Nativa; ayudas a brokers a conocer el inventario…»"
            value={row.identity}
            onChange={(e) => patch(idx, { identity: e.target.value })}
          />

          <div className="flex flex-wrap items-center gap-2">
            <select
              className="form-input !py-1.5 text-[12px]"
              aria-label="Guion de preguntas del agente"
              value={row.playbookId ?? ""}
              onChange={(e) => patch(idx, { playbookId: e.target.value || null })}
            >
              <option value="">Guion: ninguno propio (este agente no usa el del bot general)</option>
              {playbooks.map((pb) => (
                <option key={pb.id} value={pb.id}>Guion: {pb.name}{usoGuiones ? ` — ${textoUsadoPor(usoGuiones.get(pb.id))}` : ""}</option>
              ))}
            </select>
            <select
              className="form-input !py-1.5 text-[12px]"
              aria-label="Estilo de conversación del agente"
              value={row.tonePreset ?? ""}
              onChange={(e) => patch(idx, { tonePreset: e.target.value || null })}
            >
              <option value="">Estilo: {general ? textoHereda("estilo", general.botConfig) : "igual que el bot general"}</option>
              {AGENT_TONE_PRESETS.map((t) => (
                <option key={t} value={t}>Estilo: {TONE_LABEL[t] ?? t}</option>
              ))}
            </select>
            <span className="flex-1" />
            <button className="btn-secondary !py-1.5 !px-2 text-[12px]" title="Eliminar agente" aria-label="Eliminar agente" onClick={() => remove(idx)}>
              <Trash2 className="h-3.5 w-3.5" />
            </button>
            <button className="btn-primary !py-1.5 !px-3 text-[12px]" disabled={savingIdx === idx} onClick={() => save(idx)}>
              <Save className="h-3.5 w-3.5" /> {savingIdx === idx ? "Guardando..." : "Guardar"}
            </button>
          </div>

          <details className="text-[12px]" style={{ color: "var(--text-secondary)" }}>
            <summary className="cursor-pointer select-none">Avanzado</summary>
            <label className="mt-2 flex flex-wrap items-center gap-2">
              Orden de preferencia
              <input
                className="form-input w-20 !py-1.5 text-[12px]"
                type="number"
                min={1}
                max={999}
                value={row.priority}
                onChange={(e) => patch(idx, { priority: Number(e.target.value) || 100 })}
              />
              <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                Si dos agentes atienden el mismo tipo de contacto, gana el de número menor.
              </span>
            </label>
          </details>
        </div>
      ))}
    </div>
  );
}
