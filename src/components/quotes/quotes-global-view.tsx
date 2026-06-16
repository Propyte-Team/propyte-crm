"use client";

// ============================================================
// QuotesGlobalView — Lista global de cotizaciones con filtros
// ============================================================

import { useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Search, X } from "lucide-react";

type QuoteStatus = "DRAFT" | "SENT" | "OPENED" | "ACCEPTED" | "EXPIRED" | "CANCELLED";

const STATUS_CONFIG: Record<QuoteStatus, { label: string; className: string }> = {
  DRAFT:     { label: "Borrador",   className: "bg-zinc-100 text-zinc-600 border-zinc-200" },
  SENT:      { label: "Enviada",    className: "bg-blue-50 text-blue-700 border-blue-200" },
  OPENED:    { label: "Abierta",    className: "bg-amber-50 text-amber-700 border-amber-200" },
  ACCEPTED:  { label: "Aceptada",   className: "bg-green-50 text-green-700 border-green-200" },
  EXPIRED:   { label: "Vencida",    className: "bg-red-50 text-red-700 border-red-200" },
  CANCELLED: { label: "Cancelada",  className: "bg-zinc-100 text-zinc-400 border-zinc-200" },
};

const ALL_STATUSES = Object.keys(STATUS_CONFIG) as QuoteStatus[];

const SCHEME_LABEL: Record<string, string> = {
  CONTADO: "Contado",
  FINANCIAMIENTO_DIRECTO: "Fin. Directo",
  CREDITO_BANCARIO: "Créd. Bancario",
  MIXTO: "Mixto",
};

interface Quote {
  id: string;
  status: QuoteStatus;
  currency: string;
  listPrice: number;
  discountPct: number;
  finalPrice: number;
  scheme: string;
  createdAt: string;
  expiresAt?: string | null;
  deal: {
    id: string;
    contact: { id: string; firstName: string; lastName: string };
    development?: { id: string; name: string } | null;
  };
  createdBy: { id: string; name: string };
  paymentPlan?: { id: string; monthsCount: number } | null;
}

interface QuotesGlobalViewProps {
  initialQuotes: Quote[];
  userRole: string;
}

export function QuotesGlobalView({ initialQuotes }: QuotesGlobalViewProps) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<QuoteStatus | "ALL">("ALL");

  const fmt = (v: number, cur: string) =>
    new Intl.NumberFormat("es-MX", { style: "currency", currency: cur }).format(v);

  const fmtDate = (d: string) =>
    format(new Date(d), "dd MMM yyyy", { locale: es });

  const filtered = useMemo(() => {
    let list = initialQuotes;

    if (statusFilter !== "ALL") {
      list = list.filter((q) => q.status === statusFilter);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (item) =>
          `${item.deal.contact.firstName} ${item.deal.contact.lastName}`
            .toLowerCase()
            .includes(q) ||
          item.deal.development?.name.toLowerCase().includes(q) ||
          item.scheme.toLowerCase().includes(q)
      );
    }

    return list;
  }, [initialQuotes, statusFilter, search]);

  // Stats
  const stats = useMemo(() => {
    const byStatus = ALL_STATUSES.reduce(
      (acc, s) => ({ ...acc, [s]: initialQuotes.filter((q) => q.status === s).length }),
      {} as Record<QuoteStatus, number>
    );
    const totalAccepted = initialQuotes
      .filter((q) => q.status === "ACCEPTED")
      .reduce((acc, q) => acc + q.finalPrice, 0);
    return { byStatus, totalAccepted };
  }, [initialQuotes]);

  return (
    <div className="space-y-5">
      {/* Stats chips */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setStatusFilter("ALL")}
          className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
            statusFilter === "ALL"
              ? "border-zinc-900 bg-zinc-900 text-white"
              : "border-border text-zinc-600 hover:border-zinc-400"
          }`}
        >
          Todas ({initialQuotes.length})
        </button>
        {ALL_STATUSES.map((s) => {
          const { label, className } = STATUS_CONFIG[s];
          const count = stats.byStatus[s];
          if (count === 0) return null;
          return (
            <button
              key={s}
              onClick={() => setStatusFilter(s === statusFilter ? "ALL" : s)}
              className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                statusFilter === s
                  ? "border-zinc-900 bg-zinc-900 text-white"
                  : className
              }`}
            >
              {label} ({count})
            </button>
          );
        })}
      </div>

      {/* Barra de búsqueda */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
        <Input
          className="rounded-none border-border pl-9 pr-9 focus:ring-1 focus:ring-zinc-900"
          placeholder="Buscar por contacto, desarrollo o esquema…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <button
            onClick={() => setSearch("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Tabla */}
      {filtered.length === 0 ? (
        <div className="border border-dashed border-zinc-200 py-16 text-center text-sm text-zinc-400">
          {search || statusFilter !== "ALL"
            ? "Sin resultados para los filtros actuales."
            : "Aún no hay cotizaciones. Para crear una: 1) crea un contacto, 2) crea un deal en el Pipeline, 3) abre el deal y genera la cotización desde ahí."}
        </div>
      ) : (
        <div className="border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-zinc-50">
                <th className="py-3 px-4 text-left text-xs font-medium uppercase tracking-widest text-zinc-400">
                  Contacto
                </th>
                <th className="py-3 px-4 text-left text-xs font-medium uppercase tracking-widest text-zinc-400">
                  Desarrollo
                </th>
                <th className="py-3 px-4 text-right text-xs font-medium uppercase tracking-widest text-zinc-400">
                  Precio final
                </th>
                <th className="py-3 px-4 text-left text-xs font-medium uppercase tracking-widest text-zinc-400">
                  Esquema
                </th>
                <th className="py-3 px-4 text-left text-xs font-medium uppercase tracking-widest text-zinc-400">
                  Plan
                </th>
                <th className="py-3 px-4 text-left text-xs font-medium uppercase tracking-widest text-zinc-400">
                  Estado
                </th>
                <th className="py-3 px-4 text-left text-xs font-medium uppercase tracking-widest text-zinc-400">
                  Fecha
                </th>
                <th className="py-3 px-4 text-right text-xs font-medium uppercase tracking-widest text-zinc-400 w-20">
                  Ver
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((q) => {
                const config = STATUS_CONFIG[q.status] ?? STATUS_CONFIG.DRAFT;
                return (
                  <tr
                    key={q.id}
                    className="border-b border-border last:border-0 hover:bg-zinc-50/50 transition-colors"
                  >
                    <td className="py-3 px-4 font-medium text-zinc-800">
                      {q.deal.contact.firstName} {q.deal.contact.lastName}
                    </td>
                    <td className="py-3 px-4 text-zinc-500">
                      {q.deal.development?.name ?? (
                        <span className="text-zinc-300">—</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-semibold">
                      {fmt(q.finalPrice, q.currency)}
                    </td>
                    <td className="py-3 px-4 text-zinc-600">
                      {SCHEME_LABEL[q.scheme] ?? q.scheme}
                    </td>
                    <td className="py-3 px-4 text-xs text-zinc-500">
                      {q.paymentPlan
                        ? `${q.paymentPlan.monthsCount > 0 ? `${q.paymentPlan.monthsCount}m` : "Contado"}`
                        : <span className="text-zinc-300">—</span>}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${config.className}`}
                      >
                        {config.label}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-zinc-500 text-xs">
                      {fmtDate(q.createdAt)}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <Link
                        href={`/contacts/${q.deal.contact.id}?tab=cotizaciones`}
                        className="text-xs text-zinc-400 hover:text-zinc-700 underline underline-offset-2 transition-colors"
                      >
                        Ver deal
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Footer con total */}
          <div className="flex items-center justify-between border-t border-border bg-zinc-50 px-4 py-2">
            <span className="text-xs text-zinc-400">{filtered.length} de {initialQuotes.length} cotizaciones</span>
            {stats.totalAccepted > 0 && (
              <span className="text-xs text-zinc-500">
                Valor aceptado:{" "}
                <span className="font-mono font-semibold text-green-700">
                  {fmt(stats.totalAccepted, "MXN")}
                </span>
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
