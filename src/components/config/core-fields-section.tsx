// Configuración → Visibilidad de campos core por rol (Fase B).
// Eliges un rol y ajustas, por campo, si lo OCULTAS / solo LECTURA / EDITA.
// Default (sin override) = EDIT. Enforcement real en API/server.
"use client";

import { useState, useEffect, useCallback } from "react";

type Access = "HIDDEN" | "READ" | "EDIT";

interface FieldDef {
  key: string;
  label: string;
  group: string;
}
interface PermRow {
  fieldKey: string;
  role: string;
  access: Access;
}

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Admin",
  DIRECTOR: "Director",
  GERENTE: "Gerente",
  TEAM_LEADER: "Team Leader",
  ASESOR_SR: "Asesor Sr",
  ASESOR_JR: "Asesor Jr",
  ASESOR: "Asesor",
  BROKER: "Broker",
  HOSTESS: "Hostess",
  MARKETING: "Marketing",
  MANTENIMIENTO: "Mantenimiento",
  DEVELOPER_EXT: "Developer ext.",
};

const ACCESS_LABELS: Record<Access, string> = {
  EDIT: "Edita",
  READ: "Solo lectura",
  HIDDEN: "Oculto",
};

export function CoreFieldsSection({ userRole }: { userRole: string }) {
  const isAdmin = userRole === "ADMIN";
  const [object] = useState("contact");
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [perms, setPerms] = useState<PermRow[]>([]);
  const [role, setRole] = useState("ASESOR");
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/metadata/core-fields?object=${object}`);
    if (res.ok) {
      const { data } = await res.json();
      setFields(data.fields ?? []);
      setRoles(data.roles ?? []);
      setPerms(data.permissions ?? []);
    }
  }, [object]);
  useEffect(() => { load(); }, [load]);

  function accessFor(fieldKey: string): Access {
    return (perms.find((p) => p.fieldKey === fieldKey && p.role === role)?.access ?? "EDIT") as Access;
  }

  async function change(fieldKey: string, access: Access) {
    // Optimista
    setPerms((prev) => {
      const rest = prev.filter((p) => !(p.fieldKey === fieldKey && p.role === role));
      return access === "EDIT" ? rest : [...rest, { fieldKey, role, access }];
    });
    const res = await fetch("/api/admin/metadata/core-fields", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ object, fieldKey, role, access }),
    });
    setMsg(res.ok ? "Guardado ✓" : "Error al guardar");
    if (!res.ok) load();
    setTimeout(() => setMsg(""), 1500);
  }

  if (!isAdmin) {
    return <p className="text-[13px] text-[color:var(--text-tertiary)]">Solo ADMIN puede configurar la visibilidad de campos.</p>;
  }

  // Agrupar campos
  const groups = fields.reduce<Record<string, FieldDef[]>>((acc, f) => {
    (acc[f.group] ??= []).push(f);
    return acc;
  }, {});

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Visibilidad de campos por rol</h2>
        <p className="text-[13px] text-[color:var(--text-tertiary)]">
          Controla qué campos del contacto ve y edita cada rol. Sin override = puede editar.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <span className="text-[13px] text-[color:var(--text-secondary)]">Rol</span>
        <select className="form-input max-w-[220px] text-[13px]" value={role} onChange={(e) => setRole(e.target.value)}>
          {roles.map((r) => (
            <option key={r} value={r}>{ROLE_LABELS[r] ?? r}</option>
          ))}
        </select>
        {msg && <span className="text-[12px] text-[color:var(--text-tertiary)]">{msg}</span>}
      </div>

      <div className="space-y-4">
        {Object.entries(groups).map(([group, gfields]) => (
          <div key={group} className="crm-card">
            <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-[color:var(--text-tertiary)]">{group}</h3>
            <div className="divide-y" style={{ borderColor: "var(--border-subtle)" }}>
              {gfields.map((f) => {
                const a = accessFor(f.key);
                return (
                  <div key={f.key} className="flex items-center justify-between gap-3 py-2">
                    <span className="text-[13px] text-[color:var(--text-primary)]">{f.label}</span>
                    <div className="flex gap-1">
                      {(["EDIT", "READ", "HIDDEN"] as Access[]).map((opt) => (
                        <button
                          key={opt}
                          onClick={() => change(f.key, opt)}
                          className="rounded border px-2 py-1 text-[12px]"
                          style={{
                            borderColor: a === opt ? "var(--color-teal, #0D9488)" : "var(--border-default)",
                            background: a === opt ? "var(--color-teal, #0D9488)" : "transparent",
                            color: a === opt ? "var(--text-inverse, #fff)" : "var(--text-secondary)",
                          }}
                        >
                          {ACCESS_LABELS[opt]}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
