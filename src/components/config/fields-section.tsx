// Configuración → Módulos & Campos: catálogo anti-sprawl + alta de campo custom.
"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Archive } from "lucide-react";

interface FieldDef {
  id: string;
  objectApiName: string;
  apiName: string;
  label: string;
  fieldType: string;
  isRequired: boolean;
  isSystem: boolean;
  isActive: boolean;
  options: Array<{ value: string; label: string }>;
}

const FIELD_TYPES = ["TEXT", "TEXTAREA", "NUMBER", "CURRENCY", "DATE", "BOOLEAN", "EMAIL", "PHONE", "URL", "PICKLIST"];

export function FieldsSection({ userRole }: { userRole: string }) {
  const isAdmin = userRole === "ADMIN";
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [object, setObject] = useState("contact");
  const [draft, setDraft] = useState({ apiName: "", label: "", fieldType: "TEXT", isRequired: false, options: "" });
  const [msg, setMsg] = useState("");
  const [similar, setSimilar] = useState<Array<{ apiName: string; label: string }>>([]);

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/metadata/fields?object=${object}`);
    if (res.ok) setFields((await res.json()).data ?? []);
  }, [object]);
  useEffect(() => { load(); }, [load]);

  async function create(force = false) {
    setMsg("");
    setSimilar([]);
    const body: Record<string, unknown> = {
      objectApiName: object,
      apiName: draft.apiName.trim(),
      label: draft.label.trim(),
      fieldType: draft.fieldType,
      isRequired: draft.isRequired,
      force,
    };
    if (draft.fieldType === "PICKLIST") {
      body.options = draft.options.split(",").map((o) => o.trim()).filter(Boolean)
        .map((o) => ({ value: o.toLowerCase().replace(/\s+/g, "_"), label: o }));
    }
    const res = await fetch("/api/admin/metadata/fields", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 409) {
      setSimilar(data.similar ?? []);
      setMsg("Posibles duplicados — revisa antes de crear");
    } else if (res.ok) {
      setMsg("Campo creado ✓");
      setDraft({ apiName: "", label: "", fieldType: "TEXT", isRequired: false, options: "" });
      load();
    } else {
      setMsg(typeof data.error === "string" ? data.error : "Error de validación");
    }
  }

  async function archive(id: string) {
    if (!confirm("¿Archivar campo? Los valores se conservan (no se borran).")) return;
    await fetch("/api/admin/metadata/fields", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, archive: true }),
    });
    load();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Módulos & Campos</h1>
          <p className="text-muted-foreground">Catálogo anti-sprawl: nombre interno inmutable, archivar conserva valores</p>
        </div>
        <select className="form-input !w-40 !py-1.5" value={object} onChange={(e) => setObject(e.target.value)}>
          <option value="contact">Contacto</option>
          <option value="deal">Deal</option>
        </select>
      </div>

      {isAdmin && (
        <div className="crm-card !p-4 space-y-3">
          <p className="text-[13px] font-semibold">Nuevo campo en {object === "contact" ? "Contacto" : "Deal"}</p>
          <div className="grid gap-3 sm:grid-cols-4">
            <input className="form-input" placeholder={`${object}_mi_campo`} value={draft.apiName} onChange={(e) => setDraft({ ...draft, apiName: e.target.value })} />
            <input className="form-input" placeholder="Etiqueta visible" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
            <select className="form-input" value={draft.fieldType} onChange={(e) => setDraft({ ...draft, fieldType: e.target.value })}>
              {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <label className="flex items-center gap-2 text-[13px]" style={{ color: "var(--text-secondary)" }}>
              <input type="checkbox" checked={draft.isRequired} onChange={(e) => setDraft({ ...draft, isRequired: e.target.checked })} />
              Obligatorio
            </label>
          </div>
          {draft.fieldType === "PICKLIST" && (
            <input className="form-input" placeholder="Opciones separadas por coma: Notaría 1, Notaría 7" value={draft.options} onChange={(e) => setDraft({ ...draft, options: e.target.value })} />
          )}
          {msg && <p className="text-[12px]" style={{ color: similar.length ? "var(--color-warning)" : "var(--text-secondary)" }}>{msg}</p>}
          {similar.length > 0 && (
            <div className="space-y-1">
              {similar.map((s) => (
                <p key={s.apiName} className="text-[12px]" style={{ color: "var(--text-tertiary)" }}>· {s.apiName} — {s.label}</p>
              ))}
              <button className="btn-secondary !py-1.5 !px-3 text-[12px]" onClick={() => create(true)}>Crear de todos modos</button>
            </div>
          )}
          <button className="btn-primary !py-1.5 !px-3 text-[12px]" onClick={() => create(false)}>
            <Plus className="h-3.5 w-3.5" /> Crear campo
          </button>
        </div>
      )}

      <div className="crm-card !p-0 overflow-hidden">
        <div className="px-4 py-3 hairline-b">
          <p className="text-[13px] font-semibold">Catálogo ({fields.length})</p>
        </div>
        {fields.length === 0 && (
          <p className="px-4 py-6 text-center text-[13px]" style={{ color: "var(--text-tertiary)" }}>
            Sin campos custom en este objeto. Los campos núcleo viven en el schema tipado.
          </p>
        )}
        {fields.map((f) => (
          <div key={f.id} className="flex items-center justify-between gap-3 px-4 py-2.5 hairline-b">
            <div className="min-w-0">
              <p className="text-[13px]">
                <span className="font-medium" style={{ color: "var(--text-primary)" }}>{f.label}</span>
                <span className="num ml-2 text-[12px]" style={{ color: "var(--text-tertiary)" }}>{f.apiName}</span>
              </p>
              <div className="mt-0.5 flex gap-1.5">
                <span className="badge badge-neutral">{f.fieldType}</span>
                {f.isRequired && <span className="badge badge-warning">obligatorio</span>}
                {f.options.length > 0 && <span className="badge badge-neutral">{f.options.length} opciones</span>}
              </div>
            </div>
            {isAdmin && !f.isSystem && (
              <button title="Archivar (conserva valores)" onClick={() => archive(f.id)}>
                <Archive className="h-4 w-4" style={{ color: "var(--text-tertiary)" }} />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
