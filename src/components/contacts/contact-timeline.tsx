// Cronología unificada del contacto: bloque "tiempo en cada estado" + timeline agrupada
// por día (cambios de campo, actividades, mensajes, cadencias, creación). Carga al montar
// (misma sección siempre visible, como ActivityLog — no hay toggle de colapso aquí).
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Pencil,
  Mail,
  Phone,
  CheckSquare,
  MessageSquare,
  Repeat,
  UserPlus,
  Bell,
  type LucideIcon,
} from "lucide-react";
import { formatDate, formatDateTime } from "@/lib/format-date";
import { CONTACT_STATUS_LABELS, CONTACT_STATUS_COLORS } from "@/lib/constants";
import { humanizeDuration } from "@/lib/timeline/format";
import type { TimelineItem } from "@/lib/timeline/types";

interface StatusPeriod {
  status: string;
  enteredAt: string;
  exitedAt: string | null;
  durationMs: number;
}

interface ContactTimelineProps {
  contactId: string;
}

const KIND_FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "Todo" },
  { value: "field_change", label: "Campos" },
  { value: "activity", label: "Actividades" },
  { value: "message", label: "Mensajes" },
  { value: "enrollment", label: "Cadencias" },
];

function iconFor(item: TimelineItem): LucideIcon {
  switch (item.kind) {
    case "field_change":
      return Pencil;
    case "message":
      return MessageSquare;
    case "enrollment":
      return Repeat;
    case "created":
      return UserPlus;
    case "activity": {
      const type = String(item.meta?.activityType ?? "");
      if (type.startsWith("EMAIL")) return Mail;
      if (type.startsWith("CALL")) return Phone;
      if (type === "TASK" || type === "CALL_TASK") return CheckSquare;
      if (type.startsWith("WHATSAPP") || type.startsWith("SMS")) return MessageSquare;
      return Bell;
    }
    default:
      return Bell;
  }
}

function secondaryLine(item: TimelineItem): string | null {
  if (item.actorName && item.source) return `por ${item.actorName} · ${item.source}`;
  if (item.actorName) return `por ${item.actorName}`;
  if (item.source) return `vía ${item.source}`;
  return null;
}

export function ContactTimeline({ contactId }: ContactTimelineProps) {
  const [periods, setPeriods] = useState<StatusPeriod[]>([]);
  const [periodsAvailable, setPeriodsAvailable] = useState(false);
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [fieldChangesAvailable, setFieldChangesAvailable] = useState(true);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchPage = useCallback(
    async (opts: { before?: string; kind: string; replace: boolean }) => {
      const qs = new URLSearchParams();
      qs.set("limit", "30");
      if (opts.before) qs.set("before", opts.before);
      if (opts.kind !== "all") qs.set("kinds", opts.kind);
      const res = await fetch(`/api/contacts/${contactId}/timeline?${qs.toString()}`);
      if (!res.ok) return;
      const json = await res.json();
      setFieldChangesAvailable(json.fieldChangesAvailable ?? true);
      setItems((prev) => (opts.replace ? json.items ?? [] : [...prev, ...(json.items ?? [])]));
      setNextCursor(json.nextCursor ?? null);
    },
    [contactId]
  );

  // Bloque de estados: se carga una sola vez al montar (no depende del filtro de kinds).
  useEffect(() => {
    let alive = true;
    fetch(`/api/contacts/${contactId}/status-periods`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (!alive || !json) return;
        setPeriods(json.periods ?? []);
        setPeriodsAvailable(!!json.available);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [contactId]);

  // Timeline: se recarga al montar y cada vez que cambia el filtro de kinds.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchPage({ kind: filter, replace: true }).finally(() => {
      if (alive) setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [filter, fetchPage]);

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    await fetchPage({ before: nextCursor, kind: filter, replace: false });
    setLoadingMore(false);
  }

  const grouped = useMemo(() => {
    const map = new Map<string, TimelineItem[]>();
    for (const item of items) {
      const key = formatDate(item.ts, { day: "2-digit", month: "2-digit", year: "numeric" });
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return [...map.entries()];
  }, [items]);

  return (
    <div>
      {/* Tiempo en cada estado */}
      {periodsAvailable && periods.length > 0 && (
        <div className="mb-4 space-y-1 border-b pb-4" style={{ borderColor: "var(--border-subtle)" }}>
          <p className="mb-1.5 text-[11px] uppercase tracking-wider text-[color:var(--text-tertiary)]">
            Tiempo en cada estado
          </p>
          {periods.map((p, i) => (
            <div key={i} className="flex flex-wrap items-center justify-between gap-2 py-1 text-[13px]">
              <span className="flex items-center gap-1.5 font-medium text-[color:var(--text-primary)]">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: CONTACT_STATUS_COLORS[p.status] ?? "#9CA3AF" }}
                />
                {CONTACT_STATUS_LABELS[p.status] ?? p.status}
              </span>
              <span className="text-[color:var(--text-tertiary)]">
                entró {formatDate(p.enteredAt)} · {humanizeDuration(p.durationMs)}
                {p.exitedAt === null ? " · vigente" : ""}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Filtros */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {KIND_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className="rounded-full border px-2.5 py-1 text-xs transition-colors"
            style={{
              borderColor: "var(--border-default)",
              background: filter === f.value ? "var(--bg-row-hover)" : "var(--bg-card)",
              fontWeight: filter === f.value ? 600 : 400,
              color: "var(--text-primary)",
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Timeline agrupada por día */}
      {loading ? (
        <p className="py-6 text-center text-[13px] text-[color:var(--text-tertiary)]">Cargando cronología…</p>
      ) : items.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-[color:var(--text-tertiary)]">
          Sin eventos registrados.
        </p>
      ) : (
        <div className="space-y-4">
          {grouped.map(([day, dayItems]) => (
            <div key={day}>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[color:var(--text-tertiary)]">
                {day}
              </p>
              <div className="space-y-2.5">
                {dayItems.map((item) => {
                  const Icon = iconFor(item);
                  const secondary = secondaryLine(item);
                  return (
                    <div key={item.id} className="flex items-start gap-2.5">
                      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--text-tertiary)]" />
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] text-[color:var(--text-primary)]">{item.title}</p>
                        {item.detail && (
                          <p className="text-[13px] text-[color:var(--text-secondary)]">{item.detail}</p>
                        )}
                        {secondary && (
                          <p className="text-[11px] text-[color:var(--text-tertiary)]">{secondary}</p>
                        )}
                      </div>
                      <span className="shrink-0 whitespace-nowrap text-[11px] text-[color:var(--text-tertiary)]">
                        {formatDateTime(item.ts, { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {nextCursor && (
        <div className="mt-4 text-center">
          <button className="btn-secondary text-[13px]" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? "Cargando…" : "Cargar más"}
          </button>
        </div>
      )}

      {!fieldChangesAvailable && (
        <p className="mt-3 text-[11px] italic text-[color:var(--text-tertiary)]">
          El registro de cambios de campo se activará al aplicar la migración pendiente.
        </p>
      )}
    </div>
  );
}
