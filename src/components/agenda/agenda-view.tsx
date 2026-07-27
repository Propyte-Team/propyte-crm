// Agenda personal (spec §6): captura arriba, pendientes agrupados por vencimiento,
// notas recientes al final. Reusa las convenciones visuales de /hoy (crm-card,
// variables CSS del tema, acento solo como señal de prioridad).
"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Loader2, StickyNote, User } from "lucide-react";
import { formatDate } from "@/lib/format-date";
import {
  BUCKET_ORDER,
  BUCKET_LABEL,
  BUCKET_ACCENT,
  type AgendaBucket,
  type AgendaBuckets,
  type AgendaItem,
} from "@/lib/agenda/grouping";
import type { AgendaNote } from "@/server/agenda";
import { QuickCapture } from "./quick-capture";

interface AgendaViewProps {
  buckets: AgendaBuckets;
  total: number;
  truncated: boolean;
  notes: AgendaNote[];
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

export function AgendaView({ buckets, total, truncated, notes, firstName }: AgendaViewProps) {
  const router = useRouter();
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function complete(id: string) {
    setBusyId(id);
    setError(null);
    try {
      // Reusa el endpoint que ya existe: PATCH delega en updateActivity, que
      // aplica RBAC y sella completedAt.
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
      setBusyId(null);
    }
  }

  const nonEmpty = BUCKET_ORDER.filter((b) => buckets[b].length > 0);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
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

      {nonEmpty.length === 0 ? (
        <div className="crm-card p-6 text-center text-[13px] text-[color:var(--text-tertiary)]">
          Nada pendiente. Captura algo arriba para empezar.
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
                {buckets[bucket].length}
              </span>
            </div>
            <ul className="divide-y" style={{ borderColor: "var(--border-subtle)" }}>
              {buckets[bucket].map((item) => (
                <ItemRow key={item.id} item={item} onDone={complete} busy={busyId === item.id} />
              ))}
            </ul>
          </section>
        ))
      )}

      {notes.length > 0 && (
        <section className="crm-card !p-0 overflow-hidden">
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
  );
}
