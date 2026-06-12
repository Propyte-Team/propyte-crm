// Render dinámico de campos custom (speckit §5) — lee defs+valores del registro vía API.
// Se monta en el detalle de Contacto/Deal. Respeta field-level security (canEdit por rol).
"use client";

import { useState, useEffect, useCallback } from "react";
import { Save } from "lucide-react";

interface CustomFieldValue {
  apiName: string;
  label: string;
  fieldType: string;
  isRequired: boolean;
  helpText: string | null;
  options: Array<{ value: string; label: string; color: string | null }>;
  canEdit: boolean;
  value: unknown;
}

export function CustomFieldsSection({ object, recordId }: { object: "contact" | "deal"; recordId: string }) {
  const [fields, setFields] = useState<CustomFieldValue[]>([]);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/records/${object}/${recordId}/custom`);
      if (res.ok) setFields((await res.json()).data ?? []);
    } catch { /* tablas sin migrar → sección vacía */ }
  }, [object, recordId]);
  useEffect(() => { load(); }, [load]);

  if (fields.length === 0) return null; // sin campos custom registrados → no ocupa espacio

  function setValue(apiName: string, value: unknown) {
    setDraft((d) => ({ ...d, [apiName]: value }));
  }

  async function save() {
    if (Object.keys(draft).length === 0) return;
    setSaving(true);
    setMsg("");
    const res = await fetch(`/api/records/${object}/${recordId}/custom`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    if (res.ok) {
      setMsg("Guardado ✓");
      setDraft({});
      load();
    } else {
      const data = await res.json().catch(() => ({}));
      setMsg(typeof data.error === "string" ? data.error : "Error de validación");
    }
    setSaving(false);
  }

  function renderInput(f: CustomFieldValue) {
    const current = f.apiName in draft ? draft[f.apiName] : f.value;
    if (!f.canEdit) {
      return (
        <p className="text-[13px]" style={{ color: "var(--text-primary)" }}>
          {current == null || current === "" ? "—" : String(current)}
        </p>
      );
    }
    switch (f.fieldType) {
      case "BOOLEAN":
        return (
          <input
            type="checkbox"
            checked={Boolean(current)}
            onChange={(e) => setValue(f.apiName, e.target.checked)}
            className="h-4 w-4"
          />
        );
      case "PICKLIST":
        return (
          <select
            className="form-input"
            value={(current as string) ?? ""}
            onChange={(e) => setValue(f.apiName, e.target.value || null)}
          >
            <option value="">—</option>
            {f.options.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        );
      case "NUMBER":
      case "CURRENCY":
      case "PERCENT":
        return (
          <input
            type="number"
            className="form-input"
            value={current == null ? "" : String(current)}
            onChange={(e) => setValue(f.apiName, e.target.value === "" ? null : Number(e.target.value))}
          />
        );
      case "DATE":
        return (
          <input
            type="date"
            className="form-input"
            value={(current as string)?.slice(0, 10) ?? ""}
            onChange={(e) => setValue(f.apiName, e.target.value || null)}
          />
        );
      case "TEXTAREA":
        return (
          <textarea
            className="form-input"
            rows={2}
            value={(current as string) ?? ""}
            onChange={(e) => setValue(f.apiName, e.target.value || null)}
          />
        );
      default:
        return (
          <input
            className="form-input"
            value={(current as string) ?? ""}
            onChange={(e) => setValue(f.apiName, e.target.value || null)}
          />
        );
    }
  }

  return (
    <div className="crm-card !p-4 space-y-3">
      <p className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-tertiary)" }}>
        Campos personalizados
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((f) => (
          <div key={f.apiName} className="space-y-1">
            <label className="form-label !mb-0">
              {f.label}
              {f.isRequired && <span style={{ color: "var(--color-error)" }}> *</span>}
            </label>
            {renderInput(f)}
            {f.helpText && (
              <p className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>{f.helpText}</p>
            )}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <button className="btn-primary !py-1.5 !px-3 text-[12px]" disabled={saving || Object.keys(draft).length === 0} onClick={save}>
          <Save className="h-3.5 w-3.5" /> Guardar
        </button>
        {msg && <span className="text-[12px]" style={{ color: "var(--text-secondary)" }}>{msg}</span>}
      </div>
    </div>
  );
}
