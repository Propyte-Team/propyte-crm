// "Notas recientes" de la Agenda (#924): eliminar una, eliminar las seleccionadas o "Eliminar todo".
// Eliminar ARCHIVA (POST /api/agenda/notas/archivar), como "Eliminar todo" de Tareas hechas (#841):
// la nota sale de la Agenda pero sigue en la ficha del contacto.
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Loader2, StickyNote, Trash2, X } from "lucide-react";
import { formatDate } from "@/lib/format-date";
import type { AgendaNote } from "@/server/agenda";

type ArchiveBody = { ids: string[] } | { todas: true };

interface NotasRecientesProps {
  notes: AgendaNote[];
  /** Notas visibles en base, no solo las que se pintan. */
  total: number;
}

export function NotasRecientes({ notes, total }: NotasRecientesProps) {
  const router = useRouter();
  // Ocultas en cuanto el servidor confirma, sin esperar al refresh: así no "regresan" un instante.
  const [hidden, setHidden] = React.useState<Set<string>>(new Set());
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  // Ids en vuelo, por nota (borrar una no bloquea a las demás) y en lote.
  const [busyIds, setBusyIds] = React.useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = React.useState(false);
  const [confirmingAll, setConfirmingAll] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const visible = React.useMemo(() => notes.filter((n) => !hidden.has(n.id)), [notes, hidden]);
  // Una selección solo cuenta si la nota sigue a la vista.
  const selectedVisible = React.useMemo(
    () => visible.filter((n) => selected.has(n.id)).map((n) => n.id),
    [visible, selected],
  );
  const allSelected = visible.length > 0 && selectedVisible.length === visible.length;
  // Solo descuenta las ocultas que el refresh todavía no quitó de `notes`: tras el refresh,
  // `total` ya viene sin ellas y restarlas otra vez daría de menos.
  const remaining = Math.max(0, total - (notes.length - visible.length));

  if (visible.length === 0) return null;

  async function archive(body: ArchiveBody): Promise<boolean> {
    setError(null);
    try {
      const res = await fetch("/api/agenda/notas/archivar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "No se pudieron eliminar las notas");
      }
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron eliminar las notas");
      return false;
    }
  }

  function hide(ids: string[]) {
    setHidden((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      return next;
    });
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
  }

  async function removeOne(id: string) {
    setBusyIds((prev) => new Set(prev).add(id));
    const ok = await archive({ ids: [id] });
    setBusyIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    if (ok) {
      hide([id]);
      router.refresh();
    }
  }

  async function removeSelected() {
    const ids = selectedVisible;
    if (ids.length === 0) return;
    setBulkBusy(true);
    const ok = await archive({ ids });
    setBulkBusy(false);
    if (ok) {
      hide(ids);
      router.refresh();
    }
  }

  async function removeAll() {
    setBulkBusy(true);
    const ok = await archive({ todas: true });
    setBulkBusy(false);
    if (ok) {
      setConfirmingAll(false);
      hide(visible.map((n) => n.id));
      router.refresh();
    }
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(visible.map((n) => n.id)));
  }

  const busy = bulkBusy || busyIds.size > 0;

  return (
    <section id="agenda-notas" className="crm-card !p-0 scroll-mt-4 overflow-hidden">
      <div
        className="flex flex-wrap items-center gap-2 px-4 py-3"
        style={{ borderBottom: "1px solid var(--border-subtle)" }}
      >
        <input
          type="checkbox"
          checked={allSelected}
          onChange={toggleAll}
          disabled={busy}
          aria-label={allSelected ? "Quitar la selección" : "Seleccionar todas las notas visibles"}
          title={allSelected ? "Quitar la selección" : "Seleccionar todas"}
          className="h-4 w-4 shrink-0 cursor-pointer"
        />
        <StickyNote className="h-4 w-4" style={{ color: "var(--text-tertiary)" }} />
        <span className="flex-1 text-[13px] font-semibold text-[color:var(--text-primary)]">
          Notas recientes
        </span>

        {selectedVisible.length > 0 && (
          <>
            <button
              type="button"
              onClick={removeSelected}
              disabled={busy}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-semibold disabled:opacity-40"
              style={{ border: "1px solid #DC2626", color: "#DC2626" }}
            >
              {bulkBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              Eliminar seleccionadas ({selectedVisible.length})
            </button>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              disabled={busy}
              aria-label="Cancelar selección"
              title="Cancelar selección"
              className="rounded-md p-1 text-[color:var(--text-tertiary)] disabled:opacity-40"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </>
        )}

        {!confirmingAll && (
          <button
            type="button"
            onClick={() => setConfirmingAll(true)}
            disabled={busy}
            className="flex items-center gap-1 text-[12px] font-semibold disabled:opacity-40"
            style={{ color: "#DC2626" }}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Eliminar todo
          </button>
        )}
      </div>

      {confirmingAll && (
        <div
          className="flex flex-col gap-2 px-4 py-3 text-[12px]"
          style={{ borderBottom: "1px solid var(--border-subtle)", background: "rgba(220,38,38,0.05)" }}
          role="alertdialog"
          aria-label="Confirmar eliminar todas las notas"
        >
          <p className="text-[color:var(--text-primary)]">
            Dejarás de ver {remaining} nota{remaining === 1 ? "" : "s"} en tu agenda. Las que están ligadas a un
            contacto se siguen viendo en su ficha.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={removeAll}
              disabled={bulkBusy}
              className="flex items-center gap-1.5 rounded-md px-3 py-1.5 font-semibold disabled:opacity-40"
              style={{ background: "#DC2626", color: "#fff" }}
            >
              {bulkBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Sí, eliminar todo
            </button>
            <button
              type="button"
              onClick={() => setConfirmingAll(false)}
              disabled={bulkBusy}
              className="rounded-md px-3 py-1.5 font-medium disabled:opacity-40"
              style={{ border: "1px solid var(--border-subtle)", color: "var(--text-secondary)" }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="px-4 pt-2 text-[12px]" style={{ color: "#DC2626" }}>
          {error}
        </p>
      )}

      <ul className="divide-y" style={{ borderColor: "var(--border-subtle)" }}>
        {visible.map((n) => {
          const rowBusy = busyIds.has(n.id);
          const isSelected = selected.has(n.id);
          return (
            <li
              key={n.id}
              className="group flex items-center gap-3 px-4 py-2.5"
              style={isSelected ? { background: "rgba(220,38,38,0.04)" } : undefined}
            >
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => toggle(n.id)}
                disabled={rowBusy || bulkBusy}
                aria-label={`Seleccionar nota: ${n.subject}`}
                className="h-4 w-4 shrink-0 cursor-pointer"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] text-[color:var(--text-primary)]">{n.subject}</p>
                <p className="num text-[11px] text-[color:var(--text-tertiary)]">
                  {formatDate(n.createdAt, { day: "2-digit", month: "short" })}
                  {n.contactName ? ` · ${n.contactName}` : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => removeOne(n.id)}
                disabled={rowBusy || bulkBusy}
                aria-label={`Eliminar nota: ${n.subject}`}
                title="Eliminar nota"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[color:var(--text-tertiary)] transition-colors hover:bg-red-500/10 hover:text-[#DC2626] focus-visible:text-[#DC2626] disabled:opacity-40"
              >
                {rowBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              </button>
            </li>
          );
        })}
        {remaining > visible.length && (
          <li className="px-4 py-2 text-center text-[11px] text-[color:var(--text-tertiary)]">
            Se muestran las {visible.length} más recientes de {remaining}.
          </li>
        )}
      </ul>
    </section>
  );
}
