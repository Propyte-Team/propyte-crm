// Configuración → Equipos & Territorios (gestión del territorio estilo Zoho).
"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, UserMinus } from "lucide-react";

interface TeamData {
  id: string;
  name: string;
  plaza: string;
  isActive: boolean;
  leader: { id: string; name: string } | null;
  forecastManager: { id: string; name: string } | null;
  members: Array<{ id: string; roleInTeam: string; user: { id: string; name: string; isActive: boolean } }>;
}
interface TerritoryData {
  id: string;
  name: string;
  type: string;
  plaza: string | null;
  zones: string[];
  isActive: boolean;
  parentTerritory: { name: string } | null;
  members: Array<{ accessLevel: string; user: { id: string; name: string } }>;
  rules: Array<{ id: string; priority: number; isActive: boolean }>;
}
interface UserOpt { id: string; name: string; role: string }

export function TeamsSection({ userRole }: { userRole: string }) {
  const canEdit = ["ADMIN", "DIRECTOR", "GERENTE"].includes(userRole);
  const [teams, setTeams] = useState<TeamData[]>([]);
  const [territories, setTerritories] = useState<TerritoryData[]>([]);
  const [users, setUsers] = useState<UserOpt[]>([]);
  const [newTeam, setNewTeam] = useState({ name: "", plaza: "TULUM", leaderId: "" });
  const [newTerritory, setNewTerritory] = useState({ name: "", plaza: "TULUM", zones: "" });
  const [addMember, setAddMember] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const [t, te, u] = await Promise.all([
      fetch("/api/admin/teams"),
      fetch("/api/admin/territories"),
      fetch("/api/users?basic=true&isActive=true"),
    ]);
    if (t.ok) setTeams((await t.json()).data ?? []);
    if (te.ok) setTerritories((await te.json()).data ?? []);
    if (u.ok) setUsers((await u.json()).data ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function createTeam() {
    if (!newTeam.name.trim()) return;
    const res = await fetch("/api/admin/teams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...newTeam, leaderId: newTeam.leaderId || undefined }),
    });
    const data = await res.json().catch(() => ({}));
    setMsg(res.ok ? (data.warning ?? "Equipo creado ✓") : (typeof data.error === "string" ? data.error : "Error"));
    if (res.ok) setNewTeam({ name: "", plaza: "TULUM", leaderId: "" });
    load();
  }

  async function createTerritory() {
    if (!newTerritory.name.trim()) return;
    const res = await fetch("/api/admin/territories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newTerritory.name,
        plaza: newTerritory.plaza,
        zones: newTerritory.zones.split(",").map((z) => z.trim()).filter(Boolean),
      }),
    });
    const data = await res.json().catch(() => ({}));
    setMsg(res.ok ? (data.warning ?? "Territorio creado ✓") : (typeof data.error === "string" ? data.error : "Error"));
    if (res.ok) setNewTerritory({ name: "", plaza: "TULUM", zones: "" });
    load();
  }

  async function addTeamMember(teamId: string) {
    const userId = addMember[teamId];
    if (!userId) return;
    const res = await fetch(`/api/admin/teams/${teamId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    if (!res.ok) setMsg((await res.json().catch(() => ({})))?.error ?? "Error");
    setAddMember({ ...addMember, [teamId]: "" });
    load();
  }

  async function removeMember(teamId: string, userId: string) {
    await fetch(`/api/admin/teams/${teamId}?userId=${userId}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Equipos & Territorios</h1>
        <p className="text-muted-foreground">El ruteo asigna PRIMERO por territorio, luego por estrategia dentro de él</p>
      </div>
      {msg && <p className="text-[13px]" style={{ color: "var(--text-secondary)" }}>{msg}</p>}

      {/* Equipos */}
      <div className="crm-card !p-0 overflow-hidden">
        <div className="flex flex-wrap items-end justify-between gap-3 px-4 py-3 hairline-b">
          <p className="text-[13px] font-semibold">Equipos</p>
          {canEdit && (
            <div className="flex flex-wrap items-center gap-2">
              <input className="form-input !w-44 !py-1.5 text-[13px]" placeholder="Nombre del equipo" value={newTeam.name} onChange={(e) => setNewTeam({ ...newTeam, name: e.target.value })} />
              <select className="form-input !w-28 !py-1.5 text-[13px]" value={newTeam.plaza} onChange={(e) => setNewTeam({ ...newTeam, plaza: e.target.value })}>
                <option value="TULUM">Tulum</option><option value="PDC">PDC</option><option value="MERIDA">Mérida</option>
              </select>
              <select className="form-input !w-44 !py-1.5 text-[13px]" value={newTeam.leaderId} onChange={(e) => setNewTeam({ ...newTeam, leaderId: e.target.value })}>
                <option value="">Líder (opcional)</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
              <button className="btn-primary !py-1.5 !px-3 text-[12px]" onClick={createTeam}><Plus className="h-3.5 w-3.5" /> Crear</button>
            </div>
          )}
        </div>
        {teams.length === 0 && <p className="px-4 py-6 text-center text-[13px]" style={{ color: "var(--text-tertiary)" }}>Sin equipos. Crea el primero arriba.</p>}
        {teams.map((t) => (
          <div key={t.id} className="px-4 py-3 hairline-b">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-medium">{t.name}</span>
              <span className="badge badge-neutral">{t.plaza}</span>
              {t.leader && <span className="text-[12px]" style={{ color: "var(--text-secondary)" }}>Líder: {t.leader.name}</span>}
              {!t.forecastManager && <span className="badge badge-warning">sin forecast manager</span>}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {t.members.map((m) => (
                <span key={m.id} className="badge badge-neutral inline-flex items-center gap-1">
                  {m.user.name} · {m.roleInTeam}
                  {canEdit && (
                    <button title="Sacar del equipo" onClick={() => removeMember(t.id, m.user.id)}>
                      <UserMinus className="h-3 w-3" />
                    </button>
                  )}
                </span>
              ))}
              {canEdit && (
                <span className="inline-flex items-center gap-1">
                  <select className="form-input !w-40 !py-1 text-[12px]" value={addMember[t.id] ?? ""} onChange={(e) => setAddMember({ ...addMember, [t.id]: e.target.value })}>
                    <option value="">+ agregar miembro</option>
                    {users.filter((u) => !t.members.some((m) => m.user.id === u.id)).map((u) => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </select>
                  {addMember[t.id] && (
                    <button className="btn-secondary !py-1 !px-2 text-[12px]" onClick={() => addTeamMember(t.id)}>OK</button>
                  )}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Territorios */}
      <div className="crm-card !p-0 overflow-hidden">
        <div className="flex flex-wrap items-end justify-between gap-3 px-4 py-3 hairline-b">
          <p className="text-[13px] font-semibold">Territorios</p>
          {canEdit && (
            <div className="flex flex-wrap items-center gap-2">
              <input className="form-input !w-44 !py-1.5 text-[13px]" placeholder="Nombre" value={newTerritory.name} onChange={(e) => setNewTerritory({ ...newTerritory, name: e.target.value })} />
              <select className="form-input !w-28 !py-1.5 text-[13px]" value={newTerritory.plaza} onChange={(e) => setNewTerritory({ ...newTerritory, plaza: e.target.value })}>
                <option value="TULUM">Tulum</option><option value="PDC">PDC</option><option value="MERIDA">Mérida</option>
              </select>
              <input className="form-input !w-52 !py-1.5 text-[13px]" placeholder="Zonas (coma): Aldea Zama, Centro" value={newTerritory.zones} onChange={(e) => setNewTerritory({ ...newTerritory, zones: e.target.value })} />
              <button className="btn-primary !py-1.5 !px-3 text-[12px]" onClick={createTerritory}><Plus className="h-3.5 w-3.5" /> Crear</button>
            </div>
          )}
        </div>
        {territories.length === 0 && <p className="px-4 py-6 text-center text-[13px]" style={{ color: "var(--text-tertiary)" }}>Sin territorios. Sin ellos, el ruteo usa round-robin global (válido).</p>}
        {territories.map((t) => (
          <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hairline-b">
            <div>
              <span className="text-[13px] font-medium">{t.name}</span>
              {t.parentTerritory && <span className="text-[12px]" style={{ color: "var(--text-tertiary)" }}> ⊂ {t.parentTerritory.name}</span>}
              <div className="mt-1 flex flex-wrap gap-1.5">
                {t.plaza && <span className="badge badge-neutral">{t.plaza}</span>}
                {t.zones.map((z) => <span key={z} className="badge badge-neutral">{z}</span>)}
                <span className="badge badge-neutral">{t.members.length} miembros</span>
                <span className="badge badge-neutral">{t.rules.length} reglas</span>
              </div>
            </div>
            <p className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
              Miembros y reglas: vía API PUT /api/admin/territories (builder visual en próxima fase)
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
