// Agenda personal (spec §6) en tres zonas (HUB #841):
//  - izquierda: índice (como "Mi Actividad abierta" de Zoho) con filtro por periodo y atajos;
//  - centro: captura arriba, pendientes agrupados por vencimiento, notas recientes;
//  - derecha: "Tareas hechas" con "Eliminar todo", que ARCHIVA (no borra).
// Reusa las convenciones visuales de /hoy (crm-card, variables CSS del tema, acento solo
// como señal de prioridad).
"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, CheckSquare, Loader2, StickyNote, Trash2, User } from "lucide-react";
import { formatDate } from "@/lib/format-date";
import {
  BUCKET_ORDER,
  BUCKET_LABEL,
  BUCKET_ACCENT,
  type AgendaBucket,
  type AgendaBuckets,
  type AgendaItem,
} from "@/lib/agenda/grouping";
import { PERIODO_LABEL, PERIODO_ORDER, matchPeriodo, type Periodo } from "@/lib/agenda/periodo";
import type { AgendaNote, AgendaDoneItem } from "@/server/agenda";
import { QuickCapture } from "./quick-capture";

interface AgendaViewProps {
  buckets: AgendaBuckets;
  total: number;
  truncated: boolean;
  notes: AgendaNote[];
  doneTasks: AgendaDoneItem[];
  doneTotal: number;
  firstName: string;
}

function ItemRow({ item, onDone, busy }: { item: AgendaItem; onDone: (id: string) => void; busy: boolean }) {
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <button
        type="button"
        onClick={() => onDone(item.id)}
        disabled={busy}
        aria-label={`Completar: ${item.subject}`}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors disabled:opacity-40"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" style={{ color: "var(--text-tertiary)" }} />}
      </button>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] text-[color:var(--text-primary)]">{item.subject}</p>
        {item.contactId && item.contactName && (
          <Link
            href={`/contacts/${item.contactId}`}
            className="flex items-center gap-1 text-[11px] text-[color:var(--text-tertiary)] hover:underline"
          >
            <User className="h-3 w-3" />
            {item.contactName}
          </Link>
        )}
      </div>

      {item.dueDate && (
        <span className="num shrink-0 text-[11px] text-[color:var(--text-tertiary)]">
          {formatDate(item.dueDate, { day: "2-digit", month: "short" })}
        </span>
      )}
    </li>
  );
}

/** Entrada del índice izquierdo: atajo a una sección con su contador. */
function IndexLink({
  href,
  icon: Icon,
  label,
  count,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  count: number;
}) {
  return (
    <a
      href={href}
      className="flex items-center gap-2 rounded-md px-3 py-2 text-[13px] text-[color:var(--text-primary)] transition-colors hover:bg-black/5"
    >
      <Icon className="h-4 w-4 shrink-0 text-[color:var(--text-tertiary)]" />
      <span className="flex-1">{label}</span>
      <span
        className="num min-w-6 rounded-full px-2 py-0.5 text-center text-[11px] font-semibold"
        style={{ background: "var(--border-subtle)", color: "var(--text-secondary)" }}
      >
        {count}
      </span>
    </a>
  );
}

export function AgendaView({
  buckets,
  total,
  truncated,
  notes,
  doneTasks,
  doneTotal,
  firstName,
}: AgendaViewProps) {
  const router = useRouter();
  // Conjunto de ids en vuelo, no un solo id: con un solo `busyId`, completar A
  // y luego B antes de que A resuelva apagaba el spinner de A de inmediato
  // (permitiendo un segundo clic) y el `finally` de A borraba también el
  // estado "en vuelo" de B al resolver, aunque B seguía pendiente.
  const [busyIds, setBusyIds] = React.useState<Set<string>>(new Set());
  const [error, setError] = React.useState<string | null>(null);

  // Filtro por periodo del índice. "Todas" es el default para no esconder las tareas sin
  // fecha, que son el caso principal de la captura rápida.
  const [periodo, setPeriodo] = React.useState<Periodo>("todas");
  const [fechaKey, setFechaKey] = React.useState("");
  const now = React.useMemo(() => new Date(), []);

  // "Eliminar todo": confirmación en línea de dos pasos y estado de envío.
  const [confirmingArchive, setConfirmingArchive] = React.useState(false);
  const [archiving, setArchiving] = React.useState(false);

  async function complete(id: string) {
    setBusyIds((prev) => new Set(prev).add(id));
    setError(null);
    try {
      // Reusa el endpoint que ya existe: PATCH delega en updateActivity, que
      // aplica RBAC y sella completedAt y completedById.
      const res = await fetch(`/api/activities/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "COMPLETADA" }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "No se pudo completar");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo completar");
    } finally {
      // Actualización funcional: no pisa cambios que otro `complete()`
      // concurrente haya hecho al conjunto mientras este PATCH estaba en vuelo.
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  async function archiveDone() {
    setArchiving(true);
    setError(null);
    try {
      const res = await fetch("/api/agenda/hechas/archivar", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "No se pudieron archivar las tareas");
      }
      setConfirmingArchive(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron archivar las tareas");
    } finally {
      setArchiving(false);
    }
  }

  // Pendientes que caen en el periodo elegido (contadores y lista usan lo mismo).
  const filtered = React.useMemo(() => {
    const out = {} as AgendaBuckets;
    for (const b of BUCKET_ORDER) {
      out[b] = buckets[b].filter((i) => matchPeriodo(i.dueDate, periodo, now, fechaKey || undefined));
    }
    return out;
  }, [buckets, periodo, fechaKey, now]);

  const nonEmpty = BUCKET_ORDER.filter((b) => filtered[b].length > 0);
  const filteredCount = BUCKET_ORDER.reduce((sum, b) => sum + filtered[b].length, 0);

  return (
    <div className="mx-auto grid max-w-7xl gap-4 p-4 lg:grid-cols-[220px_minmax(0,1fr)_300px]">
      {/* ── Izquierda: índice ─────────────────────────────────────────── */}
      <aside className="flex flex-col gap-3 lg:sticky lg:top-4 lg:self-start" aria-label="Índice de la agenda">
        <div className="crm-card p-3">
          <h2 className="px-1 pb-2 text-[13px] font-semibold text-[color:var(--text-primary)]">
            Mi actividad abierta
          </h2>
          <select
            value={periodo}
            onChange={(e) => setPeriodo(e.target.value as Periodo)}
            aria-label="Periodo"
            className="w-full rounded-md px-3 py-2 text-[13px]"
            style={{
              background: "var(--bg-input, transparent)",
              color: "var(--text-primary)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            {PERIODO_ORDER.map((p) => (
              <option key={p} value={p}>
                {PERIODO_LABEL[p]}
              </option>
            ))}
          </select>
          {periodo === "fecha" && (
            <input
              type="date"
              value={fechaKey}
              onChange={(e) => setFechaKey(e.target.value)}
              aria-label="Fecha específica"
              className="mt-2 w-full rounded-md px-3 py-2 text-[13px]"
              style={{
                background: "var(--bg-input, transparent)",
                color: "var(--text-primary)",
                border: "1px solid var(--border-subtle)",
              }}
            />
          )}

          <nav className="flex flex-col gap-0.5 pt-3">
            <IndexLink href="#agenda-tareas" icon={CheckSquare} label="Tareas" count={filteredCount} />
            <IndexLink href="#agenda-notas" icon={StickyNote} label="Notas" count={notes.length} />
            <IndexLink href="#tareas-hechas" icon={Check} label="Tareas hechas" count={doneTotal} />
          </nav>
        </div>
      </aside>

      {/* ── Centro: lo que ya existía ─────────────────────────────────── */}
      <div className="flex min-w-0 flex-col gap-4">
        <header>
          <h1 className="text-[18px] font-semibold text-[color:var(--text-primary)]">
            Agenda de {firstName}
          </h1>
          <p className="text-[13px] text-[color:var(--text-secondary)]">
            {total === 0
              ? "Sin pendientes."
              : `${total} pendiente${total === 1 ? "" : "s"}, personales y de CRM.`}
          </p>
          {truncated && (
            <p className="pt-1 text-[12px]" style={{ color: "#D97706" }}>
              Se muestran los más próximos. Tienes más pendientes de los que caben en esta vista.
            </p>
          )}
        </header>

        <QuickCapture />

        {error && (
          <p role="alert" className="text-[12px]" style={{ color: "#DC2626" }}>
            {error}
          </p>
        )}

        <div id="agenda-tareas" className="flex scroll-mt-4 flex-col gap-4">
          {nonEmpty.length === 0 ? (
            <div className="crm-card p-6 text-center text-[13px] text-[color:var(--text-tertiary)]">
              {total === 0
                ? "Nada pendiente. Captura algo arriba para empezar."
                : "Nada pendiente en este periodo."}
            </div>
          ) : (
            nonEmpty.map((bucket: AgendaBucket) => (
              <section key={bucket} className="crm-card !p-0 overflow-hidden">
                <div
                  className="flex items-center justify-between px-4 py-3"
                  style={{ borderBottom: "1px solid var(--border-subtle)" }}
                >
                  <span className="text-[13px] font-semibold text-[color:var(--text-primary)]">
                    {BUCKET_LABEL[bucket]}
                  </span>
                  <span
                    className="num min-w-6 rounded-full px-2 py-0.5 text-center text-xs font-semibold"
                    style={{ background: BUCKET_ACCENT[bucket], color: "var(--text-inverse, #fff)" }}
                  >
                    {filtered[bucket].length}
                  </span>
                </div>
                <ul className="divide-y" style={{ borderColor: "var(--border-subtle)" }}>
                  {filtered[bucket].map((item) => (
                    <ItemRow key={item.id} item={item} onDone={complete} busy={busyIds.has(item.id)} />
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>

        {notes.length > 0 && (
          <section id="agenda-notas" className="crm-card !p-0 scroll-mt-4 overflow-hidden">
            <div
              className="flex items-center gap-2 px-4 py-3"
              style={{ borderBottom: "1px solid var(--border-subtle)" }}
            >
              <StickyNote className="h-4 w-4" style={{ color: "var(--text-tertiary)" }} />
              <span className="text-[13px] font-semibold text-[color:var(--text-primary)]">
                Notas recientes
              </span>
            </div>
            <ul className="divide-y" style={{ borderColor: "var(--border-subtle)" }}>
              {notes.map((n) => (
                <li key={n.id} className="px-4 py-2.5">
                  <p className="truncate text-[13px] text-[color:var(--text-primary)]">{n.subject}</p>
                  <p className="num text-[11px] text-[color:var(--text-tertiary)]">
                    {formatDate(n.createdAt, { day: "2-digit", month: "short" })}
                    {n.contactName ? ` · ${n.contactName}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {/* ── Derecha: Tareas hechas ────────────────────────────────────── */}
      <aside id="tareas-hechas" className="scroll-mt-4 lg:sticky lg:top-4 lg:self-start" aria-label="Tareas hechas">
        <div className="crm-card !p-0 overflow-hidden">
          <div
            className="flex items-center justify-between gap-2 px-4 py-3"
            style={{ borderBottom: "1px solid var(--border-subtle)" }}
          >
            <span className="text-[13px] font-semibold text-[color:var(--text-primary)]">
              Tareas hechas
            </span>
            {doneTotal > 0 && !confirmingArchive && (
              <button
                type="button"
                onClick={() => setConfirmingArchive(true)}
                className="flex items-center gap-1 text-[12px] font-semibold"
                style={{ color: "#DC2626" }}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Eliminar todo
              </button>
            )}
          </div>

          {confirmingArchive && (
            <div
              className="flex flex-col gap-2 px-4 py-3 text-[12px]"
              style={{ borderBottom: "1px solid var(--border-subtle)", background: "rgba(220,38,38,0.05)" }}
              role="alertdialog"
              aria-label="Confirmar eliminar todo"
            >
              <p className="text-[color:var(--text-primary)]">
                Dejarás de ver {doneTotal} tarea{doneTotal === 1 ? "" : "s"} hecha{doneTotal === 1 ? "" : "s"}.
                Se archivan: no se pierden y el administrador las conserva en sus reportes.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={archiveDone}
                  disabled={archiving}
                  className="flex items-center gap-1.5 rounded-md px-3 py-1.5 font-semibold disabled:opacity-40"
                  style={{ background: "#DC2626", color: "#fff" }}
                >
                  {archiving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Sí, eliminar
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingArchive(false)}
                  disabled={archiving}
                  className="rounded-md px-3 py-1.5 font-medium disabled:opacity-40"
                  style={{ border: "1px solid var(--border-subtle)", color: "var(--text-secondary)" }}
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {doneTasks.length === 0 ? (
            <p className="px-4 py-6 text-center text-[13px] text-[color:var(--text-tertiary)]">
              Aquí aparecerán las tareas que completes.
            </p>
          ) : (
            <ul className="flex flex-col gap-2 p-3">
              {doneTasks.map((t) => (
                <li
                  key={t.id}
                  className="rounded-md px-3 py-2"
                  style={{ border: "1px solid var(--border-subtle)" }}
                >
                  <p className="text-[13px] text-[color:var(--text-tertiary)] line-through">{t.subject}</p>
                  <p className="num flex flex-wrap items-center gap-x-2 text-[11px] text-[color:var(--text-tertiary)]">
                    {t.completedAt && (
                      <span>{formatDate(t.completedAt, { day: "2-digit", month: "short" })}</span>
                    )}
                    {t.contactId && t.contactName && (
                      <Link href={`/contacts/${t.contactId}`} className="flex items-center gap-1 hover:underline">
                        <User className="h-3 w-3" />
                        {t.contactName}
                      </Link>
                    )}
                  </p>
                </li>
              ))}
              {doneTotal > doneTasks.length && (
                <li className="px-1 pt-1 text-center text-[11px] text-[color:var(--text-tertiary)]">
                  Se muestran las {doneTasks.length} más recientes de {doneTotal}.
                </li>
              )}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}
