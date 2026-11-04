// Configuración → Visibilidad de campos core por rol (Fase B).
// Eliges un rol y ajustas, por campo, si lo OCULTAS / solo LECTURA / EDITA.
// Default (sin override) = EDIT. Enforcement real en API/server.
"use client";

import { useState, useEffect, useCallback } from "react";
import { Lock } from "lucide-react";
import { ROLE_LABELS_COMPLETO, etiqueta } from "@/lib/labels";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/use-toast";
import {
  accesoDe,
  aplicarAcceso,
  camposQueSeOcultan,
  resumenPorRol,
  textoResumen,
  type Access,
} from "@/lib/metadata/visibilidad-model";

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

// Campos que calcula o mantiene el sistema (triggers/automatizaciones): "Edita" no aplica.
export const CAMPOS_DEL_SISTEMA: ReadonlySet<string> = new Set([
  "score",
  "flujo",
  "contactStatus",
  "whatsappUserId",
]);

// Qué más controla el permiso de un campo (acoplamientos del detalle del contacto).
export const ACOPLAMIENTOS: Record<string, string> = {
  estado: "También controla: subestado y razón de salida.",
  referredById: "Si lo ocultas, la ficha tampoco muestra la lista de referidos.",
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
  const [usuariosActivos, setUsuariosActivos] = useState<Record<string, number>>({});
  const confirmar = useConfirm();

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/metadata/core-fields?object=${object}`);
    if (res.ok) {
      const { data } = await res.json();
      setFields(data.fields ?? []);
      setRoles(data.roles ?? []);
      setPerms(data.permissions ?? []);
      setUsuariosActivos(data.usuariosActivos ?? {});
    }
  }, [object]);
  useEffect(() => { load(); }, [load]);

  function accessFor(fieldKey: string): Access {
    return accesoDe(perms, fieldKey, role);
  }

  // Cambia el acceso de uno o varios campos del rol elegido (una celda o un grupo completo).
  // Si el cambio oculta campos a un rol con usuarios activos, pide confirmación antes de guardar.
  async function change(fieldKeys: string[], access: Access) {
    const aOcultar = camposQueSeOcultan(perms, role, fieldKeys, access);
    const usuarios = usuariosActivos[role] ?? 0;
    if (aOcultar.length > 0 && usuarios > 0) {
      const nombreRol = etiqueta(ROLE_LABELS_COMPLETO, role);
      const ok = await confirmar({
        titulo: `¿Ocultar ${aOcultar.length === 1 ? "este campo" : `${aOcultar.length} campos`} a ${nombreRol}?`,
        descripcion: `Hay ${usuarios} ${usuarios === 1 ? "usuario activo" : "usuarios activos"} con este puesto que dejarán de ver ${aOcultar.length === 1 ? "este dato" : "estos datos"} en la ficha.`,
        confirmar: "Ocultar",
        peligroso: true,
      });
      if (!ok) return;
    }
    const antes = perms;
    // Optimista
    setPerms((prev) => aplicarAcceso(prev, role, fieldKeys, access));
    const res = await fetch("/api/admin/metadata/core-fields", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        fieldKeys.length === 1 ? { object, fieldKey: fieldKeys[0], role, access } : { object, fieldKeys, role, access }
      ),
    });
    if (res.ok) {
      setMsg("Guardado ✓");
    } else {
      setPerms(antes);
      toast({ title: "No se pudo guardar el cambio", variant: "destructive" });
      load();
    }
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

  const resumen = resumenPorRol(perms, roles);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Visibilidad de campos por rol</h2>
        <p className="text-[13px] text-[color:var(--text-tertiary)]">
          Por defecto todos los puestos pueden editar todo; aquí restringes lo que ve y edita cada puesto.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <span className="text-[13px] text-[color:var(--text-secondary)]">Rol</span>
        <select className="form-input max-w-[220px] text-[13px]" value={role} onChange={(e) => setRole(e.target.value)}>
          {roles.map((r) => (
            <option key={r} value={r}>{etiqueta(ROLE_LABELS_COMPLETO, r)}</option>
          ))}
        </select>
        <span className="text-[12px] text-[color:var(--text-tertiary)]">
          {etiqueta(ROLE_LABELS_COMPLETO, role)}: {textoResumen(resumen.find((r) => r.role === role))}
        </span>
        {msg && <span className="text-[12px] text-[color:var(--text-tertiary)]">{msg}</span>}
      </div>

      {resumen.length > 0 && (
        <div className="crm-card !p-3">
          <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wider text-[color:var(--text-tertiary)]">Resumen por rol</p>
          <div className="flex flex-wrap gap-2">
            {resumen.map((r) => (
              <button
                key={r.role}
                onClick={() => setRole(r.role)}
                className="rounded border px-2 py-1 text-[12px]"
                style={{
                  borderColor: r.role === role ? "var(--color-teal, #0D9488)" : "var(--border-default)",
                  color: "var(--text-secondary)",
                }}
              >
                {etiqueta(ROLE_LABELS_COMPLETO, r.role)}: {textoResumen(r)}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-4">
        {Object.entries(groups).map(([group, gfields]) => (
          <div key={group} className="crm-card">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-[12px] font-semibold uppercase tracking-wider text-[color:var(--text-tertiary)]">{group}</h3>
              <div className="flex gap-1 text-[11px]">
                <button className="rounded border px-1.5 py-0.5" style={{ borderColor: "var(--border-default)" }} onClick={() => change(gfields.map((f) => f.key), "HIDDEN")}>
                  Ocultar todo el grupo
                </button>
                <button className="rounded border px-1.5 py-0.5" style={{ borderColor: "var(--border-default)" }} onClick={() => change(gfields.map((f) => f.key), "READ")}>
                  Todo solo lectura
                </button>
                <button className="rounded border px-1.5 py-0.5" style={{ borderColor: "var(--border-default)" }} onClick={() => change(gfields.map((f) => f.key), "EDIT")}>
                  Restablecer grupo
                </button>
              </div>
            </div>
            <div className="divide-y" style={{ borderColor: "var(--border-subtle)" }}>
              {gfields.map((f) => {
                const sistema = CAMPOS_DEL_SISTEMA.has(f.key);
                const raw = accessFor(f.key);
                const a: Access = sistema && raw === "EDIT" ? "READ" : raw;
                const opts: Access[] = sistema ? ["READ", "HIDDEN"] : ["EDIT", "READ", "HIDDEN"];
                return (
                  <div key={f.key} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <span className="text-[13px] text-[color:var(--text-primary)]">{f.label}</span>
                      {raw !== "EDIT" && (
                        <span className="ml-2 rounded border px-1 text-[10px] text-[color:var(--text-tertiary)]" style={{ borderColor: "var(--border-subtle)" }}>
                          Restringido
                        </span>
                      )}
                      {sistema && (
                        <p className="flex items-center gap-1 text-[11px] text-[color:var(--text-tertiary)]">
                          <Lock className="h-3 w-3" aria-hidden /> Lo calcula el sistema
                        </p>
                      )}
                      {ACOPLAMIENTOS[f.key] && (
                        <p className="text-[11px] text-[color:var(--text-tertiary)]">{ACOPLAMIENTOS[f.key]}</p>
                      )}
                    </div>
                    <div className="flex gap-1">
                      {opts.map((opt) => (
                        <button
                          key={opt}
                          onClick={() => change([f.key], opt)}
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
