// Vista Hoy — el asesor sabe qué hacer en 10 segundos (Fase 2, T2.1).
// Minimalista: tarjetas con conteo + lista accionable. Color solo como señal de prioridad.
"use client";

import Link from "next/link";
import {
  Sparkles, AlarmClock, CheckSquare, MessageSquare, CalendarDays, Flame, FileText, ArrowRight,
  type LucideIcon,
} from "lucide-react";
import type { TodayView as TodayData, TodayMini } from "@/server/today";

function relTime(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso).getTime();
  const diffMin = Math.round((d - Date.now()) / 60000);
  const abs = Math.abs(diffMin);
  const unit = abs >= 1440 ? `${Math.round(abs / 1440)}d` : abs >= 60 ? `${Math.round(abs / 60)}h` : `${abs}m`;
  if (diffMin < 0) return `hace ${unit}`;
  return `en ${unit}`;
}

interface SectionProps {
  title: string;
  icon: LucideIcon;
  count: number;
  items?: TodayMini[];
  accent?: string;
  emptyText: string;
  viewAllHref?: string;
}

function Section({ title, icon: Icon, count, items = [], accent, emptyText, viewAllHref }: SectionProps) {
  return (
    <div className="crm-card !p-0 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4" style={{ color: accent ?? "var(--text-tertiary)" }} />
          <span className="text-[13px] font-semibold text-[color:var(--text-primary)]">{title}</span>
        </div>
        <span
          className="num min-w-6 rounded-full px-2 py-0.5 text-center text-xs font-semibold"
          style={{
            background: count > 0 ? (accent ?? "var(--text-primary)") : "var(--bg-badge-neutral, #f0f0f0)",
            color: count > 0 ? "var(--text-inverse, #fff)" : "var(--text-tertiary)",
          }}
        >
          {count}
        </span>
      </div>
      {items.length > 0 ? (
        <ul className="divide-y" style={{ borderColor: "var(--border-subtle)" }}>
          {items.map((it) => {
            const row = (
              <div className="flex items-center justify-between gap-2 px-4 py-2 hover:bg-[color:var(--bg-row-hover)]">
                <div className="min-w-0">
                  <p className="truncate text-[13px] text-[color:var(--text-primary)]">{it.title}</p>
                  {it.subtitle && <p className="truncate text-[11px] text-[color:var(--text-tertiary)]">{it.subtitle}</p>}
                </div>
                <span className="shrink-0 text-[11px] text-[color:var(--text-tertiary)]">
                  {it.meta && /\d{4}-\d{2}-\d{2}T/.test(it.meta) ? relTime(it.meta) : it.meta}
                </span>
              </div>
            );
            return it.href ? <li key={it.id}><Link href={it.href}>{row}</Link></li> : <li key={it.id}>{row}</li>;
          })}
        </ul>
      ) : (
        <p className="px-4 py-6 text-center text-[12px] text-[color:var(--text-tertiary)]">{emptyText}</p>
      )}
      {viewAllHref && count > items.length && (
        <Link href={viewAllHref} className="flex items-center justify-center gap-1 px-4 py-2 text-[12px] text-[color:var(--text-secondary)] hover:underline" style={{ borderTop: "1px solid var(--border-subtle)" }}>
          Ver todos ({count}) <ArrowRight className="h-3 w-3" />
        </Link>
      )}
    </div>
  );
}

export function TodayView({ data, firstName }: { data: TodayData; firstName: string }) {
  const total =
    data.newLeads.count + data.slaAtRisk.count + data.tasks.count +
    data.conversations.count + data.visits.count;

  return (
    <div className="space-y-5">
      <div>
        <p className="eyebrow">Hoy</p>
        <h1 className="mt-1 text-[28px] font-bold leading-tight tracking-tight">Hola, {firstName}</h1>
        <p className="mt-1 text-[13px]" style={{ color: "var(--text-secondary)" }}>
          {total === 0
            ? "Estás al día. Sin pendientes urgentes ahora mismo."
            : `Tienes ${total} cosa${total === 1 ? "" : "s"} que atender hoy.`}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Section title="SLA en riesgo" icon={AlarmClock} count={data.slaAtRisk.count} items={data.slaAtRisk.items}
          accent="#DC2626" emptyText="Ningún SLA por vencer." />
        <Section title="Leads nuevos sin tocar" icon={Sparkles} count={data.newLeads.count} items={data.newLeads.items}
          accent="#2563EB" emptyText="Sin leads nuevos pendientes." viewAllHref="/contacts?status=NUEVO" />
        <Section title="Conversaciones sin responder" icon={MessageSquare} count={data.conversations.count} items={data.conversations.items}
          accent="#0D9488" emptyText="Bandeja al día." viewAllHref="/inbox" />
        <Section title="Tareas de hoy y vencidas" icon={CheckSquare} count={data.tasks.count} items={data.tasks.items}
          accent="#D97706" emptyText="Sin tareas pendientes." />
        <Section title="Visitas de hoy" icon={CalendarDays} count={data.visits.count} items={data.visits.items}
          accent="#6366F1" emptyText="Sin visitas agendadas hoy." />
        <Section title="Deals calientes" icon={Flame} count={data.hotDeals.count} items={data.hotDeals.items}
          accent="#DC2626" emptyText="Sin deals calientes activos." viewAllHref="/pipeline" />
      </div>

      <div className="crm-card flex items-center justify-between !py-3">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4" style={{ color: "var(--text-tertiary)" }} />
          <span className="text-[13px] text-[color:var(--text-secondary)]">Cotizaciones abiertas (enviadas o vistas)</span>
        </div>
        <Link href="/cotizaciones" className="num text-[15px] font-semibold hover:underline">{data.openQuotes.count}</Link>
      </div>
    </div>
  );
}
