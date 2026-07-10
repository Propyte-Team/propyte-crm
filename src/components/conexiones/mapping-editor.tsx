// Editor de mapeo Meta→Contact por conector (Task 6): filas source/target + value-map
// para enums + dry-run contra el último lead o guardado directo vía PATCH.
"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { parseRules, type MappingRule } from "@/lib/intake/map-lead";
import { TARGET_FIELDS, METADATA_KEYS, ENUM_OPTIONS } from "@/lib/intake/mapping-model";

const DIACRITICS_RE = new RegExp("[\\u0300-\\u036f]", "g");

function normalize(s: string): string {
  return s.normalize("NFD").replace(DIACRITICS_RE, "").toLowerCase();
}

const SORTED_TARGETS = [...TARGET_FIELDS].sort((a, b) => normalize(a).localeCompare(normalize(b)));

function extractError(d: any): string {
  if (typeof d?.error === "string") return d.error;
  if (Array.isArray(d?.error?.formErrors) && d.error.formErrors.length) return d.error.formErrors.join(", ");
  if (d?.error?.fieldErrors) {
    const msgs = Object.entries(d.error.fieldErrors as Record<string, string[]>).flatMap(([k, v]) =>
      (v ?? []).map((m) => `${k}: ${m}`)
    );
    if (msgs.length) return msgs.join("; ");
  }
  return "Error al guardar";
}

function emptyRule(): MappingRule {
  return { source: "question", metaField: "", target: "" };
}

function ValueMapEditor({ rule, onChange }: { rule: MappingRule; onChange: (r: MappingRule) => void }) {
  const options = ENUM_OPTIONS[rule.target] ?? [];
  const entries = Object.entries(rule.valueMap ?? {});

  function updatePair(i: number, key: string, val: string) {
    const next = [...entries];
    next[i] = [key, val];
    onChange({ ...rule, valueMap: Object.fromEntries(next) });
  }
  function removePair(i: number) {
    onChange({ ...rule, valueMap: Object.fromEntries(entries.filter((_, j) => j !== i)) });
  }
  function addPair() {
    onChange({ ...rule, valueMap: { ...(rule.valueMap ?? {}), "": options[0] ?? "" } });
  }

  return (
    <div className="mt-2 space-y-1.5 rounded-md border p-2" style={{ borderColor: "var(--border-subtle)" }}>
      <p className="text-[11px] font-medium uppercase tracking-wide" style={{ color: "var(--text-tertiary)" }}>
        Traducción de valores · {rule.target}
      </p>
      {entries.map(([k, v], i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            className="form-input text-[12px]"
            placeholder="valor origen (ej. fb)"
            value={k}
            onChange={(e) => updatePair(i, e.target.value, v)}
          />
          <span style={{ color: "var(--text-tertiary)" }}>→</span>
          <select className="form-input !w-auto text-[12px]" value={v} onChange={(e) => updatePair(i, k, e.target.value)}>
            <option value="">—</option>
            {options.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
          <button type="button" onClick={() => removePair(i)} className="shrink-0 text-[color:var(--text-tertiary)] hover:text-red-600">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <button type="button" onClick={addPair} className="btn-secondary text-[11px]">
        <Plus className="h-3 w-3" /> Traducción
      </button>
      <div className="flex flex-wrap items-center gap-2 pt-1 text-[12px]">
        <span style={{ color: "var(--text-secondary)" }}>Si no hay match:</span>
        <select
          className="form-input !w-auto text-[12px]"
          value={rule.fallback ?? "omit"}
          onChange={(e) => onChange({ ...rule, fallback: e.target.value as MappingRule["fallback"] })}
        >
          <option value="omit">omitir</option>
          <option value="passthrough">dejar valor original</option>
          <option value="fixed">valor fijo</option>
        </select>
        {rule.fallback === "fixed" && (
          <input
            className="form-input text-[12px]"
            placeholder="valor fijo"
            value={rule.fallbackValue ?? ""}
            onChange={(e) => onChange({ ...rule, fallbackValue: e.target.value })}
          />
        )}
      </div>
    </div>
  );
}

function RuleRow({
  rule,
  onChange,
  onDelete,
}: {
  rule: MappingRule;
  onChange: (r: MappingRule) => void;
  onDelete: () => void;
}) {
  const hasEnum = rule.target in ENUM_OPTIONS;
  return (
    <div className="rounded-md border p-2.5" style={{ borderColor: "var(--border-subtle)" }}>
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="form-input !w-auto text-[12px]"
          value={rule.source}
          onChange={(e) => {
            const source = e.target.value as MappingRule["source"];
            onChange({ ...rule, source, metaField: "", value: "" });
          }}
        >
          <option value="question">Pregunta</option>
          <option value="metadata">Metadata</option>
          <option value="constant">Valor fijo</option>
        </select>

        {rule.source === "question" && (
          <input
            className="form-input text-[12px]"
            placeholder="nombre de la pregunta (ej. full_name)"
            value={rule.metaField ?? ""}
            onChange={(e) => onChange({ ...rule, metaField: e.target.value })}
          />
        )}
        {rule.source === "metadata" && (
          <select
            className="form-input !w-auto text-[12px]"
            value={rule.metaField ?? ""}
            onChange={(e) => onChange({ ...rule, metaField: e.target.value })}
          >
            <option value="">— elige —</option>
            {METADATA_KEYS.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
        )}
        {rule.source === "constant" && (
          <input
            className="form-input text-[12px]"
            placeholder="valor fijo"
            value={rule.value ?? ""}
            onChange={(e) => onChange({ ...rule, value: e.target.value })}
          />
        )}

        <span style={{ color: "var(--text-tertiary)" }}>→</span>

        <input
          list="mapping-target-suggestions"
          className="form-input text-[12px]"
          placeholder="campo destino (ej. fullName, custom.presupuesto)"
          value={rule.target}
          onChange={(e) => onChange({ ...rule, target: e.target.value })}
        />

        <button type="button" onClick={onDelete} className="ml-auto shrink-0 text-[color:var(--text-tertiary)] hover:text-red-600">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {hasEnum && <ValueMapEditor rule={rule} onChange={onChange} />}
    </div>
  );
}

export function MappingEditor({
  connectorId,
  name,
  fieldMap,
  onClose,
  onSaved,
}: {
  connectorId: string;
  name: string;
  fieldMap?: unknown;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [rules, setRules] = useState<MappingRule[]>(() => parseRules(fieldMap));
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ mapped: Record<string, unknown>; usedLastLead: boolean; warnings?: string[] } | null>(null);

  function updateRule(i: number, r: MappingRule) {
    setRules((rs) => rs.map((x, j) => (j === i ? r : x)));
    setTestResult(null);
  }
  function removeRule(i: number) {
    setRules((rs) => rs.filter((_, j) => j !== i));
    setTestResult(null);
  }
  function addRule() {
    setRules((rs) => [...rs, emptyRule()]);
    setTestResult(null);
  }

  function validate(): string | null {
    for (const r of rules) {
      if (!r.target.trim()) return "Cada regla necesita un campo destino.";
      if ((r.source === "question" || r.source === "metadata") && !r.metaField?.trim()) {
        return "Las reglas de pregunta/metadata necesitan el campo origen.";
      }
      if (r.source === "constant" && !r.value?.trim()) {
        return "Las reglas de valor fijo necesitan un valor.";
      }
    }
    return null;
  }

  async function probar() {
    setErr(null);
    const v = validate();
    if (v) { setErr(v); return; }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`/api/admin/connectors/${connectorId}/test-mapping`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rules }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(extractError(d)); return; }
      setTestResult(d.data);
    } catch {
      setErr("Error de red al probar el mapeo.");
    } finally {
      setTesting(false);
    }
  }

  async function guardar() {
    setErr(null);
    const v = validate();
    if (v) { setErr(v); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/connectors/${connectorId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fieldMap: { rules } }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setErr(extractError(d));
        return;
      }
      onSaved();
      onClose();
    } catch {
      setErr("Error de red al guardar el mapeo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar mapeo · {name}</DialogTitle>
        </DialogHeader>

        <datalist id="mapping-target-suggestions">
          {SORTED_TARGETS.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>

        <p className="text-[12px]" style={{ color: "var(--text-tertiary)" }}>
          Define cómo se traducen las preguntas del formulario y los metadatos de campaña a los campos del contacto.
          Los destinos con enum (ej. contactType, temperature) permiten traducir valores.
        </p>

        <div className="space-y-2">
          {rules.map((r, i) => (
            <RuleRow key={i} rule={r} onChange={(nr) => updateRule(i, nr)} onDelete={() => removeRule(i)} />
          ))}
        </div>

        {rules.length === 0 && (
          <p className="text-[12px]" style={{ color: "var(--text-tertiary)" }}>
            Sin reglas propias todavía. Se seguirán aplicando los defaults (nombre, teléfono, email) más lo que agregues aquí.
          </p>
        )}

        <button type="button" onClick={addRule} className="btn-secondary w-fit text-[12px]">
          <Plus className="h-3.5 w-3.5" /> Agregar regla
        </button>

        {err && (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">{err}</p>
        )}

        {testResult && (
          <div className="rounded-md border p-3" style={{ borderColor: "var(--border-subtle)", background: "var(--bg-card)" }}>
            <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-tertiary)" }}>
              Resultado {testResult.usedLastLead ? "· último lead recibido" : "· sin datos de muestra"}
            </p>
            <pre className="mt-1 overflow-x-auto text-[12px]">{JSON.stringify(testResult.mapped, null, 2)}</pre>
            {testResult.warnings && testResult.warnings.length > 0 && (
              <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
                <p className="font-medium">Valores que se descartarían por no ser válidos para el campo:</p>
                <ul className="mt-1 list-disc pl-4">
                  {testResult.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <button type="button" className="btn-secondary text-[13px]" onClick={probar} disabled={testing || busy}>
            {testing ? "Probando…" : "Probar"}
          </button>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary text-[13px]" onClick={onClose} disabled={busy}>
              Cancelar
            </button>
            <button type="button" className="btn-primary text-[13px]" onClick={guardar} disabled={busy}>
              {busy ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
