"use client";

// ============================================================
// PaymentScheduleTable — tabla de parcialidades con acciones
// ============================================================

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, AlertCircle, XCircle, RotateCcw } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";

type InstallmentStatus = "PENDIENTE" | "PAGADA" | "VENCIDA" | "CONDONADA";

interface Schedule {
  id: string;
  number: number;
  dueDate: string;
  amount: number;
  status: InstallmentStatus;
  paidAt?: string | null;
  paidAmount?: number | null;
  notes?: string | null;
}

interface PaymentScheduleTableProps {
  quoteId: string;
  schedules: Schedule[];
  currency: "MXN" | "USD";
  onUpdate: (updated: Schedule) => void;
}

const STATUS_BADGE: Record<InstallmentStatus, { label: string; className: string }> = {
  PENDIENTE: { label: "Pendiente", className: "bg-zinc-100 text-zinc-600 border-zinc-200" },
  PAGADA: { label: "Pagada", className: "bg-green-50 text-green-700 border-green-200" },
  VENCIDA: { label: "Vencida", className: "bg-red-50 text-red-700 border-red-200" },
  CONDONADA: { label: "Condonada", className: "bg-zinc-100 text-zinc-500 border-zinc-200 line-through" },
};

export function PaymentScheduleTable({
  quoteId,
  schedules,
  currency,
  onUpdate,
}: PaymentScheduleTableProps) {
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const fmt = (v: number) =>
    new Intl.NumberFormat("es-MX", { style: "currency", currency }).format(v);

  const fmtDate = (d: string) =>
    format(new Date(d), "dd MMM yyyy", { locale: es });

  const updateStatus = async (id: string, status: InstallmentStatus) => {
    setLoadingId(id);
    try {
      const res = await fetch(
        `/api/quotes/${quoteId}/installments/${id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        }
      );
      const json = await res.json();
      if (res.ok && json.data) {
        onUpdate(json.data);
      }
    } finally {
      setLoadingId(null);
    }
  };

  const totalPaid = schedules
    .filter((s) => s.status === "PAGADA")
    .reduce((acc, s) => acc + (s.paidAmount ?? s.amount), 0);
  const totalPending = schedules
    .filter((s) => s.status === "PENDIENTE" || s.status === "VENCIDA")
    .reduce((acc, s) => acc + s.amount, 0);

  return (
    <div className="space-y-3">
      {/* Resumen */}
      <div className="flex gap-6 text-xs">
        <div>
          <span className="text-zinc-400 uppercase tracking-widest">Cobrado</span>
          <p className="font-mono font-semibold text-green-700">{fmt(totalPaid)}</p>
        </div>
        <div>
          <span className="text-zinc-400 uppercase tracking-widest">Pendiente</span>
          <p className="font-mono font-semibold text-zinc-900">{fmt(totalPending)}</p>
        </div>
      </div>

      {/* Tabla */}
      <div className="border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-zinc-50">
              <th className="py-3 px-4 text-left text-xs font-medium uppercase tracking-widest text-zinc-400 w-10">
                #
              </th>
              <th className="py-3 px-4 text-left text-xs font-medium uppercase tracking-widest text-zinc-400">
                Vence
              </th>
              <th className="py-3 px-4 text-right text-xs font-medium uppercase tracking-widest text-zinc-400">
                Monto
              </th>
              <th className="py-3 px-4 text-left text-xs font-medium uppercase tracking-widest text-zinc-400">
                Estado
              </th>
              <th className="py-3 px-4 text-left text-xs font-medium uppercase tracking-widest text-zinc-400">
                Pagado el
              </th>
              <th className="py-3 px-4 text-right text-xs font-medium uppercase tracking-widest text-zinc-400 w-40">
                Acciones
              </th>
            </tr>
          </thead>
          <tbody>
            {schedules.map((s) => {
              const { label, className } = STATUS_BADGE[s.status] ?? STATUS_BADGE.PENDIENTE;
              const isLoading = loadingId === s.id;
              const isPast =
                s.status === "PENDIENTE" && new Date(s.dueDate) < new Date();

              return (
                <tr
                  key={s.id}
                  className="border-b border-border last:border-0 hover:bg-zinc-50/50 transition-colors"
                >
                  <td className="py-3 px-4 font-mono text-zinc-400">{s.number}</td>
                  <td className="py-3 px-4">
                    <span className={isPast ? "text-red-600" : "text-zinc-700"}>
                      {fmtDate(s.dueDate)}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right font-mono font-medium">
                    {fmt(s.amount)}
                  </td>
                  <td className="py-3 px-4">
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${className}`}
                    >
                      {label}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-zinc-500 text-xs">
                    {s.paidAt ? fmtDate(s.paidAt) : "—"}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {s.status !== "PAGADA" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs text-green-700 hover:bg-green-50"
                          onClick={() => updateStatus(s.id, "PAGADA")}
                          disabled={isLoading}
                          title="Marcar como pagada"
                        >
                          <CheckCircle className="h-3.5 w-3.5 mr-1" />
                          Pagada
                        </Button>
                      )}
                      {s.status === "PENDIENTE" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs text-red-700 hover:bg-red-50"
                          onClick={() => updateStatus(s.id, "VENCIDA")}
                          disabled={isLoading}
                          title="Marcar como vencida"
                        >
                          <AlertCircle className="h-3.5 w-3.5 mr-1" />
                          Vencida
                        </Button>
                      )}
                      {s.status !== "CONDONADA" && s.status !== "PENDIENTE" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs text-zinc-500 hover:bg-zinc-50"
                          onClick={() => updateStatus(s.id, "PENDIENTE")}
                          disabled={isLoading}
                          title="Revertir a pendiente"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {s.status !== "CONDONADA" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs text-zinc-400 hover:bg-zinc-50"
                          onClick={() => updateStatus(s.id, "CONDONADA")}
                          disabled={isLoading}
                          title="Condonar"
                        >
                          <XCircle className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
