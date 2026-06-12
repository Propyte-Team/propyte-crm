"use client";

// ============================================================
// QuoteList — tabla de cotizaciones de un deal con acciones
// ============================================================

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { QuoteForm } from "./quote-form";
import { PaymentPlanForm } from "./payment-plan-form";
import { PaymentScheduleTable } from "./payment-schedule-table";
import { Plus, ChevronDown, ChevronRight, Send, Trash2, Pencil } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";

type QuoteStatus = "DRAFT" | "SENT" | "OPENED" | "ACCEPTED" | "EXPIRED" | "CANCELLED";

const STATUS_CONFIG: Record<
  QuoteStatus,
  { label: string; className: string }
> = {
  DRAFT:     { label: "Borrador",   className: "bg-zinc-100 text-zinc-600 border-zinc-200" },
  SENT:      { label: "Enviada",    className: "bg-blue-50 text-blue-700 border-blue-200" },
  OPENED:    { label: "Abierta",    className: "bg-amber-50 text-amber-700 border-amber-200" },
  ACCEPTED:  { label: "Aceptada",   className: "bg-green-50 text-green-700 border-green-200" },
  EXPIRED:   { label: "Vencida",    className: "bg-red-50 text-red-700 border-red-200" },
  CANCELLED: { label: "Cancelada",  className: "bg-zinc-100 text-zinc-400 border-zinc-200" },
};

const SCHEME_LABEL: Record<string, string> = {
  CONTADO: "Contado",
  FINANCIAMIENTO_DIRECTO: "Fin. Directo",
  CREDITO_BANCARIO: "Crédito bancario",
  MIXTO: "Mixto",
};

interface QuoteListProps {
  dealId: string;
}

export function QuoteList({ dealId }: QuoteListProps) {
  const [quotes, setQuotes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editQuote, setEditQuote] = useState<any | null>(null);
  const [planQuote, setPlanQuote] = useState<any | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/quotes?dealId=${dealId}`);
      const json = await res.json();
      if (res.ok) setQuotes(json.data ?? []);
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => { load(); }, [load]);

  const fmtMoney = (v: number, cur: string) =>
    new Intl.NumberFormat("es-MX", { style: "currency", currency: cur }).format(v);

  const fmtDate = (d: string) =>
    format(new Date(d), "dd MMM yyyy", { locale: es });

  const handleDelete = async (id: string) => {
    if (!confirm("¿Eliminar esta cotización?")) return;
    const res = await fetch(`/api/quotes/${id}`, { method: "DELETE" });
    if (res.ok) setQuotes((prev) => prev.filter((q) => q.id !== id));
  };

  const handleSend = async (id: string) => {
    const res = await fetch(`/api/quotes/${id}/send`, { method: "POST" });
    if (res.ok) {
      const json = await res.json();
      setQuotes((prev) => prev.map((q) => (q.id === id ? { ...q, ...json.data } : q)));
    }
  };

  const handleInstallmentUpdate = (quoteId: string, updated: any) => {
    setQuotes((prev) =>
      prev.map((q) => {
        if (q.id !== quoteId || !q.paymentPlan) return q;
        return {
          ...q,
          paymentPlan: {
            ...q.paymentPlan,
            schedules: q.paymentPlan.schedules.map((s: any) =>
              s.id === updated.id ? updated : s
            ),
          },
        };
      })
    );
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-widest text-zinc-400">Cotizaciones</p>
          <h2 className="text-lg font-semibold text-zinc-900">{quotes.length} cotización{quotes.length !== 1 ? "es" : ""}</h2>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Nueva cotización
        </Button>
      </div>

      {/* Tabla */}
      {loading ? (
        <div className="py-12 text-center text-sm text-zinc-400">Cargando…</div>
      ) : quotes.length === 0 ? (
        <div className="border border-dashed border-zinc-200 py-12 text-center text-sm text-zinc-400">
          No hay cotizaciones para este deal.
        </div>
      ) : (
        <div className="border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-zinc-50">
                <th className="py-3 px-4 text-left text-xs font-medium uppercase tracking-widest text-zinc-400 w-8" />
                <th className="py-3 px-4 text-left text-xs font-medium uppercase tracking-widest text-zinc-400">
                  #
                </th>
                <th className="py-3 px-4 text-left text-xs font-medium uppercase tracking-widest text-zinc-400">
                  Unidad
                </th>
                <th className="py-3 px-4 text-right text-xs font-medium uppercase tracking-widest text-zinc-400">
                  Precio final
                </th>
                <th className="py-3 px-4 text-left text-xs font-medium uppercase tracking-widest text-zinc-400">
                  Esquema
                </th>
                <th className="py-3 px-4 text-left text-xs font-medium uppercase tracking-widest text-zinc-400">
                  Estado
                </th>
                <th className="py-3 px-4 text-left text-xs font-medium uppercase tracking-widest text-zinc-400">
                  Fecha
                </th>
                <th className="py-3 px-4 text-right text-xs font-medium uppercase tracking-widest text-zinc-400 w-36">
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody>
              {quotes.map((q, i) => {
                const config = STATUS_CONFIG[q.status as QuoteStatus] ?? STATUS_CONFIG.DRAFT;
                const isExpanded = expanded === q.id;
                return (
                  <>
                    <tr
                      key={q.id}
                      className="border-b border-border last:border-0 hover:bg-zinc-50/50 transition-colors"
                    >
                      <td className="py-3 px-4">
                        <button
                          onClick={() => setExpanded(isExpanded ? null : q.id)}
                          className="text-zinc-400 hover:text-zinc-700 transition-colors"
                        >
                          {isExpanded ? (
                            <ChevronDown className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </td>
                      <td className="py-3 px-4 font-mono text-zinc-400">{i + 1}</td>
                      <td className="py-3 px-4 text-zinc-600 text-xs">
                        {q.hubUnitId ? (
                          <span className="font-mono">{q.hubUnitId.slice(0, 8)}…</span>
                        ) : (
                          <span className="text-zinc-300">—</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-semibold">
                        {fmtMoney(q.finalPrice, q.currency)}
                      </td>
                      <td className="py-3 px-4 text-zinc-600">
                        {SCHEME_LABEL[q.scheme] ?? q.scheme}
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
                        <div className="flex items-center justify-end gap-1">
                          {q.status === "DRAFT" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs text-blue-700 hover:bg-blue-50"
                              onClick={() => handleSend(q.id)}
                              title="Marcar como enviada"
                            >
                              <Send className="h-3 w-3 mr-1" />
                              Enviar
                            </Button>
                          )}
                          {!q.paymentPlan && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs"
                              onClick={() => setPlanQuote(q)}
                              title="Crear plan de pago"
                            >
                              Plan
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 text-zinc-400 hover:text-zinc-700"
                            onClick={() => setEditQuote(q)}
                            title="Editar"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 text-zinc-400 hover:text-red-600"
                            onClick={() => handleDelete(q.id)}
                            title="Eliminar"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>

                    {/* Expansión: plan de pago */}
                    {isExpanded && q.paymentPlan && (
                      <tr key={`${q.id}-plan`} className="bg-zinc-50/50">
                        <td colSpan={8} className="px-8 py-4">
                          <PaymentScheduleTable
                            quoteId={q.id}
                            schedules={q.paymentPlan.schedules}
                            currency={q.currency}
                            onUpdate={(updated) => handleInstallmentUpdate(q.id, updated)}
                          />
                        </td>
                      </tr>
                    )}

                    {isExpanded && !q.paymentPlan && (
                      <tr key={`${q.id}-noplan`} className="bg-zinc-50/50">
                        <td colSpan={8} className="px-8 py-4">
                          <div className="flex items-center gap-3">
                            <span className="text-sm text-zinc-400">
                              Esta cotización no tiene plan de pago.
                            </span>
                            <Button
                              size="sm"
                              variant="outline"
                              className="rounded-none"
                              onClick={() => setPlanQuote(q)}
                            >
                              <Plus className="mr-1.5 h-3.5 w-3.5" />
                              Crear plan
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Dialog: crear cotización */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Nueva cotización</DialogTitle>
          </DialogHeader>
          <QuoteForm
            dealId={dealId}
            onSuccess={(q) => {
              setQuotes((prev) => [q, ...prev]);
              setCreateOpen(false);
            }}
            onCancel={() => setCreateOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Dialog: editar cotización */}
      <Dialog open={!!editQuote} onOpenChange={(o) => !o && setEditQuote(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Editar cotización</DialogTitle>
          </DialogHeader>
          {editQuote && (
            <QuoteForm
              dealId={dealId}
              initial={editQuote}
              onSuccess={(q) => {
                setQuotes((prev) => prev.map((x) => (x.id === q.id ? q : x)));
                setEditQuote(null);
              }}
              onCancel={() => setEditQuote(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Dialog: plan de pago */}
      <Dialog open={!!planQuote} onOpenChange={(o) => !o && setPlanQuote(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Crear plan de pago</DialogTitle>
          </DialogHeader>
          {planQuote && (
            <PaymentPlanForm
              quoteId={planQuote.id}
              finalPrice={planQuote.finalPrice}
              currency={planQuote.currency}
              onSuccess={(plan) => {
                setQuotes((prev) =>
                  prev.map((q) =>
                    q.id === planQuote.id ? { ...q, paymentPlan: plan } : q
                  )
                );
                setPlanQuote(null);
                setExpanded(planQuote.id);
              }}
              onCancel={() => setPlanQuote(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
