// Tabla de Reuniones o Llamadas pendientes de la Agenda (HUB #842) con "Gestionar columnas"
// al estilo de Zoho CRM: el asesor elige qué columnas ver y la preferencia se guarda en su
// navegador (localStorage, por tabla). Reusa las convenciones visuales de agenda-view.
"use client";

import React from "react";
import Link from "next/link";
import { Check, Loader2, Search, SlidersHorizontal } from "lucide-react";
import { formatDateTime } from "@/lib/format-date";
import {
  COLUMNAS,
  columnasVisibles,
  filtrarColumnas,
  storageKeyColumnas,
  type TablaAgenda,
} from "@/lib/agenda/columnas";
import type { AgendaActivityRow } from "@/server/agenda";

interface AgendaTableProps {
  tabla: TablaAgenda;
  id: string;
  titulo: string;
  icon: React.ComponentType<{ className?: string }>;
  rows: AgendaActivityRow[];
  /** Texto cuando no hay filas: la tabla (encabezados y "Columnas") se muestra igual. */
  vacio: string;
  onDone: (id: string) => void;
  busyIds: Set<string>;
}

const TIPO_REUNION: Record<string, string> = {
  MEETING_VIRTUAL: "Virtual",
  MEETING_PRESENTIAL: "Presencial",
  MEETING_SHOWROOM: "Showroom",
};

const TIPO_LLAMADA: Record<string, string> = {
  CALL_OUTBOUND: "Saliente",
  CALL_INBOUND: "Entrante",
};

const FECHA_HORA: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
};

const dash = "—";

function fecha(iso: string | null): string {
  return iso ? formatDateTime(iso, FECHA_HORA) : dash;
}

/** Fin de la reunión: inicio + duración. Sin duración registrada no hay fin que mostrar. */
function fin(row: AgendaActivityRow): string {
  if (!row.dueDate || !row.durationMinutes) return dash;
  const end = new Date(new Date(row.dueDate).getTime() + row.durationMinutes * 60_000);
  return formatDateTime(end, FECHA_HORA);
}

function celda(tabla: TablaAgenda, key: string, row: AgendaActivityRow): React.ReactNode {
  const texto = (v: string | null | undefined) => (v && v.trim() ? v : dash);

  if (key === "contacto") {
    return row.contactId && row.contactName ? (
      <Link href={`/contacts/${row.contactId}`} className="hover:underline">
        {row.contactName}
      </Link>
    ) : (
      dash
    );
  }
  if (key === "relacionado") return texto(row.dealLabel);
  if (key === "descripcion") return texto(row.description);

  if (tabla === "reuniones") {
    switch (key) {
      case "titulo":
        return row.subject;
      case "de":
        return fecha(row.dueDate);
      case "a":
        return fin(row);
      case "host":
      case "creadoPor":
        return texto(row.userName);
      case "tipo":
        return TIPO_REUNION[row.activityType] ?? dash;
      case "resultado":
        return texto(row.outcome);
      case "creado":
        return fecha(row.createdAt);
      case "modificado":
        return fecha(row.updatedAt);
    }
  } else {
    switch (key) {
      case "asunto":
        return row.subject;
      case "inicio":
        return fecha(row.dueDate);
      case "telefono":
        return texto(row.contactPhone);
      case "propietario":
        return texto(row.userName);
      case "tipo":
        return TIPO_LLAMADA[row.activityType] ?? dash;
      case "duracion":
        return row.durationMinutes ? `${row.durationMinutes} min` : dash;
    }
  }
  return dash;
}

function leerGuardadas(tabla: TablaAgenda): unknown {
  try {
    const raw = window.localStorage.getItem(storageKeyColumnas(tabla));
    return raw ? JSON.parse(raw) : null;
  } catch {
    // Sin storage (modo privado, bloqueado) o JSON corrupto: se usan los valores por defecto.
    return null;
  }
}

function guardar(tabla: TablaAgenda, keys: string[]) {
  try {
    window.localStorage.setItem(storageKeyColumnas(tabla), JSON.stringify(keys));
  } catch {
    // La preferencia solo dura la sesión de la pestaña; no es motivo para fallar.
  }
}

/** Modal "Gestionar columnas": buscador, casillas y Cancelar/Guardar. */
function GestionarColumnas({
  tabla,
  visibles,
  onClose,
  onSave,
}: {
  tabla: TablaAgenda;
  visibles: string[];
  onClose: () => void;
  onSave: (keys: string[]) => void;
}) {
  const defs = COLUMNAS[tabla];
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

        <div className="flex justify-end gap-2">
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
  );
}

export function AgendaTable({ tabla, id, titulo, icon: Icon, rows, vacio, onDone, busyIds }: AgendaTableProps) {
  const defs = COLUMNAS[tabla];
  // Arranca con los valores por defecto (igual en servidor y cliente) y aplica la preferencia
  // guardada tras montar, para no provocar un mismatch de hidratación.
  const [visibles, setVisibles] = React.useState<string[]>(() => columnasVisibles(defs, null));
  const [abierto, setAbierto] = React.useState(false);

  React.useEffect(() => {
    setVisibles(columnasVisibles(defs, leerGuardadas(tabla)));
  }, [defs, tabla]);

  const columnas = defs.filter((d) => visibles.includes(d.key));

  return (
    <section id={id} className="crm-card !p-0 scroll-mt-4 overflow-hidden">
      <div
        className="flex items-center justify-between gap-2 px-4 py-3"
        style={{ borderBottom: "1px solid var(--border-subtle)" }}
      >
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-[color:var(--text-tertiary)]" />
          <span className="text-[13px] font-semibold text-[color:var(--text-primary)]">{titulo}</span>
          <span
            className="num min-w-6 rounded-full px-2 py-0.5 text-center text-[11px] font-semibold"
            style={{ background: "var(--border-subtle)", color: "var(--text-secondary)" }}
          >
            {rows.length}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setAbierto(true)}
          aria-label={`Gestionar columnas de ${titulo}`}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium text-[color:var(--text-secondary)] hover:bg-black/5"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Columnas
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-max border-collapse text-left text-[13px]">
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
              <th className="w-10 px-4 py-2" aria-label="Completar" />
              {columnas.map((c) => (
                <th
                  key={c.key}
                  className="whitespace-nowrap px-3 py-2 text-[12px] font-semibold text-[color:var(--text-secondary)]"
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y" style={{ borderColor: "var(--border-subtle)" }}>
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={columnas.length + 1}
                  className="px-4 py-6 text-center text-[13px] text-[color:var(--text-tertiary)]"
                >
                  {vacio}
                </td>
              </tr>
            )}
            {rows.map((row) => {
              const busy = busyIds.has(row.id);
              return (
                <tr key={row.id}>
                  <td className="px-4 py-2.5">
                    <button
                      type="button"
                      onClick={() => onDone(row.id)}
                      disabled={busy}
                      aria-label={`Completar: ${row.subject}`}
                      className="flex h-5 w-5 items-center justify-center rounded border transition-colors disabled:opacity-40"
                      style={{ borderColor: "var(--border-subtle)" }}
                    >
                      {busy ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Check className="h-3 w-3" style={{ color: "var(--text-tertiary)" }} />
                      )}
                    </button>
                  </td>
                  {columnas.map((c) => (
                    <td
                      key={c.key}
                      className="max-w-[280px] truncate px-3 py-2.5 text-[color:var(--text-primary)]"
                      title={typeof celda(tabla, c.key, row) === "string" ? (celda(tabla, c.key, row) as string) : undefined}
                    >
                      {celda(tabla, c.key, row)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {abierto && (
        <GestionarColumnas
          tabla={tabla}
          visibles={visibles}
          onClose={() => setAbierto(false)}
          onSave={(keys) => {
            setVisibles(keys);
            guardar(tabla, keys);
            setAbierto(false);
          }}
        />
      )}
    </section>
  );
}
