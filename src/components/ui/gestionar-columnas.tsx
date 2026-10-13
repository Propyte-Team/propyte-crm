// "Gestionar columnas" reutilizable (referencia: Zoho CRM): botón, modal con buscador y casillas,
// y la preferencia guardada en el navegador por tabla. Nació en la Agenda (HUB #842,
// components/agenda/agenda-table.tsx); esta versión recibe el catálogo en vez de una tabla
// de Agenda para que la use cualquier listado (Contactos primero).
//
// Pendiente: agenda-table.tsx todavía tiene su propia copia del modal. Se dejó así para no
// chocar con el trabajo en curso sobre ese archivo (HUB #860); al mezclarse, que use este.
"use client";

import React from "react";
import { Search, SlidersHorizontal } from "lucide-react";
import { columnasVisibles, filtrarColumnas, type ColumnaDef } from "@/lib/agenda/columnas";

function leer(storageKey: string): unknown {
  try {
    const raw = window.localStorage.getItem(storageKey);
    return raw ? JSON.parse(raw) : null;
  } catch {
    // Sin storage (modo privado, bloqueado) o JSON corrupto: valores por defecto.
    return null;
  }
}

function escribir(storageKey: string, keys: string[]) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(keys));
  } catch {
    // La preferencia solo dura mientras la pestaña esté abierta; no es motivo para fallar.
  }
}

/**
 * Columnas visibles de una tabla + función para guardarlas. Arranca con los valores por
 * defecto (iguales en servidor y cliente) y aplica la preferencia guardada tras montar, para
 * no provocar un mismatch de hidratación.
 */
export function useColumnasVisibles(
  defs: ColumnaDef[],
  storageKey: string
): [string[], (keys: string[]) => void] {
  const [visibles, setVisibles] = React.useState<string[]>(() => columnasVisibles(defs, null));

  React.useEffect(() => {
    setVisibles(columnasVisibles(defs, leer(storageKey)));
  }, [defs, storageKey]);

  const guardar = React.useCallback(
    (keys: string[]) => {
      const limpias = columnasVisibles(defs, keys);
      setVisibles(limpias);
      escribir(storageKey, limpias);
    },
    [defs, storageKey]
  );

  return [visibles, guardar];
}

/** Botón "Columnas" que abre el modal. */
export function BotonColumnas({ onClick, titulo }: { onClick: () => void; titulo: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Gestionar columnas de ${titulo}`}
      className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium text-[color:var(--text-secondary)] hover:bg-black/5"
    >
      <SlidersHorizontal className="h-3.5 w-3.5" />
      Columnas
    </button>
  );
}

/** Modal "Gestionar columnas": buscador, casillas, Restablecer y Cancelar/Guardar. */
export function GestionarColumnas({
  defs,
  visibles,
  onClose,
  onSave,
}: {
  defs: ColumnaDef[];
  visibles: string[];
  onClose: () => void;
  onSave: (keys: string[]) => void;
}) {
  const [draft, setDraft] = React.useState<Set<string>>(() => new Set(visibles));
  const [busqueda, setBusqueda] = React.useState("");
  const lista = filtrarColumnas(defs, busqueda);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function toggle(key: string) {
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Gestionar columnas"
        className="flex max-h-[80vh] w-full max-w-sm flex-col gap-3 rounded-xl p-4 shadow-xl"
        style={{ background: "var(--bg-card, #fff)", border: "1px solid var(--border-subtle)" }}
      >
        <h3 className="text-[15px] font-semibold text-[color:var(--text-primary)]">Gestionar columnas</h3>

        <div
          className="flex items-center gap-2 rounded-md px-3 py-2"
          style={{ border: "1px solid var(--border-subtle)" }}
        >
          <Search className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--text-tertiary)" }} />
          <input
            type="text"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar"
            aria-label="Buscar columna"
            autoFocus
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none"
          />
        </div>

        <ul className="min-h-0 flex-1 overflow-auto">
          {lista.length === 0 && (
            <li className="px-1 py-2 text-[12px] text-[color:var(--text-tertiary)]">Sin resultados</li>
          )}
          {lista.map((d) => (
            <li key={d.key}>
              <label className="flex cursor-pointer items-center gap-2 px-1 py-1.5 text-[13px] text-[color:var(--text-primary)]">
                <input
                  type="checkbox"
                  checked={d.required || draft.has(d.key)}
                  disabled={d.required}
                  onChange={() => toggle(d.key)}
                />
                <span>
                  {d.label}
                  {d.required && <span style={{ color: "#DC2626" }}>*</span>}
                </span>
              </label>
            </li>
          ))}
        </ul>

        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setDraft(new Set(columnasVisibles(defs, null)))}
            className="text-[12px] font-medium text-[color:var(--text-secondary)] hover:underline"
          >
            Restablecer
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-[13px] font-medium"
              style={{ border: "1px solid var(--border-subtle)", color: "var(--text-secondary)" }}
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => onSave(columnasVisibles(defs, Array.from(draft)))}
              className="rounded-md px-4 py-1.5 text-[13px] font-semibold"
              style={{ background: "var(--text-primary)", color: "var(--text-inverse, #fff)" }}
            >
              Guardar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
