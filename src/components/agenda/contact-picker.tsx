// Buscador de contacto para la captura de la Agenda (HUB #841). Reusa GET /api/contacts?search=,
// que ya aplica el alcance por rol, así que el asesor solo encuentra contactos que puede ver.
"use client";

import React from "react";
import { Loader2, Search, User, X } from "lucide-react";

export interface PickedContact {
  id: string;
  name: string;
}

interface ContactRow {
  id: string;
  firstName: string;
  lastName: string;
}

interface ContactPickerProps {
  value: PickedContact | null;
  onChange: (contact: PickedContact | null) => void;
  disabled?: boolean;
}

const inputStyle: React.CSSProperties = {
  background: "var(--bg-input, transparent)",
  color: "var(--text-primary)",
  border: "1px solid var(--border-subtle)",
};

export function ContactPicker({ value, onChange, disabled }: ContactPickerProps) {
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<ContactRow[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [open, setOpen] = React.useState(false);

  // Búsqueda con debounce; `cancelled` descarta respuestas de una consulta ya superada.
  React.useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/contacts?search=${encodeURIComponent(term)}&pageSize=6`);
        if (!res.ok) throw new Error("search failed");
        const body = await res.json();
        if (!cancelled) setResults((body.data ?? []) as ContactRow[]);
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  if (value) {
    return (
      <div
        className="flex items-center gap-2 rounded-md px-3 py-2 text-[13px]"
        style={inputStyle}
      >
        <User className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--text-tertiary)" }} />
        <span className="min-w-0 flex-1 truncate">{value.name}</span>
        <button
          type="button"
          onClick={() => onChange(null)}
          disabled={disabled}
          aria-label="Quitar contacto"
          className="shrink-0 disabled:opacity-40"
        >
          <X className="h-3.5 w-3.5" style={{ color: "var(--text-tertiary)" }} />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-2 rounded-md px-3 py-2" style={inputStyle}>
        <Search className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--text-tertiary)" }} />
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          disabled={disabled}
          placeholder="Ligar a un contacto (opcional)"
          aria-label="Buscar contacto para ligar"
          className="min-w-0 flex-1 bg-transparent text-[13px] outline-none"
        />
        {loading && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />}
      </div>

      {open && query.trim().length >= 2 && !loading && (
        <ul
          role="listbox"
          className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-md py-1 shadow-md"
          style={{ background: "var(--bg-card, #fff)", border: "1px solid var(--border-subtle)" }}
        >
          {results.length === 0 ? (
            <li className="px-3 py-2 text-[12px] text-[color:var(--text-tertiary)]">
              Sin resultados
            </li>
          ) : (
            results.map((c) => (
              <li key={c.id} role="option" aria-selected={false}>
                {/* onMouseDown (no onClick): se dispara antes del blur del input, que cierra la lista. */}
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onChange({ id: c.id, name: `${c.firstName} ${c.lastName}`.trim() });
                    setQuery("");
                    setResults([]);
                    setOpen(false);
                  }}
                  className="w-full px-3 py-2 text-left text-[13px] text-[color:var(--text-primary)] hover:bg-black/5"
                >
                  {c.firstName} {c.lastName}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
