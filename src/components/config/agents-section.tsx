// Configuración → Agentes IA: activar/pausar, autonomía, últimas corridas auditadas.
"use client";

import { useState, useEffect, useCallback } from "react";
import { Play, Plus, Pencil } from "lucide-react";
import { AgentStudio } from "./agent-studio";

interface AgentData {
  id: string;
  name: string;
  goal: string;
  autonomyLevel: string;
  allowedTools: string[];
  isActive: boolean;
  systemUser: { id?: string; name: string; role: string };
  systemUserId?: string;
  trigger?: Record<string, unknown>;
  limits?: Record<string, unknown>;
  _count: { runs: number };
  runs: Array<{ status: string; startedAt: string }>;
}

export function AgentsSection({ userRole }: { userRole: string }) {
  const canEdit = ["ADMIN", "DIRECTOR"].includes(userRole);
  const [agents, setAgents] = useState<AgentData[]>([]);
  const [availableTools, setAvailableTools] = useState<Array<{ name: string; description: string }>>([]);
  const [studio, setStudio] = useState<"new" | AgentData | null>(null);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/agents");
    if (res.ok) {
      const j = await res.json();
      setAgents(j.data ?? []);
      setAvailableTools(j.availableTools ?? []);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function toggle(agent: AgentData) {
    setMsg("");
    const res = await fetch(`/api/admin/agents/${agent.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !agent.isActive }),
    });
    if (!res.ok) setMsg("Error al guardar");
    load();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Agentes IA</h1>
          <p className="text-muted-foreground">
            Empleados digitales con identidad RBAC, herramientas acotadas y corridas auditadas.
            Requieren ANTHROPIC_API_KEY en el servidor.
          </p>
        </div>
        {canEdit && (
          <button className="btn-primary shrink-0 text-[12px]" onClick={() => setStudio("new")}>
            <Plus className="h-3.5 w-3.5" /> Nuevo agente
          </button>
        )}
      </div>
      {msg && <p className="text-[13px]" style={{ color: "var(--color-error)" }}>{msg}</p>}

      {studio && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4" style={{ background: "rgba(0,0,0,.4)" }}>
          <div className="my-8 w-full max-w-2xl rounded-lg p-5" style={{ background: "var(--bg-card)" }}>
            <h2 className="mb-4 text-lg font-semibold">{studio === "new" ? "Nuevo agente" : "Editar agente"}</h2>
            <AgentStudio
              agent={studio === "new" ? undefined : studio}
              availableTools={availableTools}
              onSaved={() => { setStudio(null); load(); }}
              onCancel={() => setStudio(null)}
            />
          </div>
        </div>
      )}

      <div className="space-y-3">
        {agents.map((a) => (
          <div key={a.id} className="crm-card !p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 max-w-2xl">
                <div className="flex items-center gap-2">
                  <p className="text-[14px] font-semibold" style={{ color: "var(--text-primary)" }}>{a.name}</p>
                  <span className="badge badge-neutral">{a.autonomyLevel}</span>
                  <span className={`badge ${a.isActive ? "badge-success" : "badge-neutral"}`}>
                    {a.isActive ? "ACTIVO" : "PAUSADO"}
                  </span>
                </div>
                <p className="mt-1 text-[12px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>{a.goal}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {a.allowedTools.map((t) => (
                    <span key={t} className="num badge badge-neutral !text-[10px]">{t}</span>
                  ))}
                </div>
                <p className="mt-2 text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                  Identidad: {a.systemUser.name} ({a.systemUser.role}) · {a._count.runs} corridas
                  {a.runs[0] && ` · última: ${a.runs[0].status} ${new Date(a.runs[0].startedAt).toLocaleString("es-MX")}`}
                </p>
              </div>
              {canEdit && (
                <div className="flex shrink-0 items-center gap-2">
                  <button className="btn-secondary !py-1.5 !px-3 text-[12px]" onClick={() => setStudio(a)}>
                    <Pencil className="h-3.5 w-3.5" /> Editar
                  </button>
                  <button
                    className={a.isActive ? "btn-secondary !py-1.5 !px-3 text-[12px]" : "btn-primary !py-1.5 !px-3 text-[12px]"}
                    onClick={() => toggle(a)}
                  >
                    <Play className="h-3.5 w-3.5" />
                    {a.isActive ? "Pausar" : "Activar"}
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
        {agents.length === 0 && (
          <p className="py-8 text-center text-[13px]" style={{ color: "var(--text-tertiary)" }}>
            Sin agentes. Corre los seeds: npx tsx scripts/seed-agentes.ts
          </p>
        )}
      </div>
    </div>
  );
}
