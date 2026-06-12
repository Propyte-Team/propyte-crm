"use client";

// ============================================================
// PaymentPlanForm — Crear plan de pago con preview de schedule
// ============================================================

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addMonths, format } from "date-fns";
import { es } from "date-fns/locale";

interface PaymentPlanFormProps {
  quoteId: string;
  finalPrice: number;
  currency: "MXN" | "USD";
  onSuccess: (plan: any) => void;
  onCancel: () => void;
}

export function PaymentPlanForm({
  quoteId,
  finalPrice,
  currency,
  onSuccess,
  onCancel,
}: PaymentPlanFormProps) {
  const [downPct, setDownPct] = useState("30");
  const [months, setMonths] = useState("12");
  const [deliveryPct, setDeliveryPct] = useState("20");
  const [startDate, setStartDate] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dp = Math.min(100, Math.max(0, parseFloat(downPct) || 0));
  const delPct = Math.min(100 - dp, Math.max(0, parseFloat(deliveryPct) || 0));
  const mo = Math.max(0, parseInt(months) || 0);

  const downAmount = finalPrice * (dp / 100);
  const deliveryAmount = finalPrice * (delPct / 100);
  const remaining = finalPrice - downAmount - deliveryAmount;
  const monthlyAmount = mo > 0 ? remaining / mo : 0;

  const fmt = (v: number) =>
    new Intl.NumberFormat("es-MX", { style: "currency", currency }).format(v);

  // Preview del schedule
  const preview = useMemo(() => {
    if (!startDate) return [];
    const base = new Date(startDate + "T12:00:00");
    const rows: { n: number; date: string; amount: number; label: string }[] = [];

    rows.push({ n: 1, date: format(base, "dd MMM yyyy", { locale: es }), amount: downAmount, label: "Enganche" });

    for (let i = 0; i < mo; i++) {
      rows.push({
        n: i + 2,
        date: format(addMonths(base, i + 1), "dd MMM yyyy", { locale: es }),
        amount: monthlyAmount,
        label: `Mensualidad ${i + 1}`,
      });
    }

    if (delPct > 0) {
      rows.push({
        n: mo + 2,
        date: format(addMonths(base, mo + 1), "dd MMM yyyy", { locale: es }),
        amount: deliveryAmount,
        label: "Entrega",
      });
    }

    return rows;
  }, [dp, delPct, mo, startDate, finalPrice]);

  const totalCheck = downAmount + monthlyAmount * mo + (delPct > 0 ? deliveryAmount : 0);
  const diff = Math.abs(totalCheck - finalPrice);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (dp <= 0) {
      setError("El enganche debe ser mayor a 0%");
      return;
    }
    if (dp + delPct > 100) {
      setError("Enganche + entrega no pueden superar el 100%");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/quotes/${quoteId}/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          downPaymentPct: dp,
          monthsCount: mo,
          deliveryPaymentPct: delPct,
          startDate: startDate ? new Date(startDate + "T12:00:00").toISOString() : undefined,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Error desconocido");
        return;
      }

      onSuccess(json.data);
    } catch {
      setError("Error al crear el plan de pago");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Resumen precio */}
      <div className="rounded-none border border-dashed border-zinc-200 bg-zinc-50 px-4 py-3">
        <div className="flex justify-between items-center">
          <span className="text-xs uppercase tracking-widest text-zinc-400">Precio final</span>
          <span className="font-mono text-base font-semibold">{fmt(finalPrice)}</span>
        </div>
      </div>

      {/* Fecha inicio */}
      <div className="space-y-1.5">
        <Label className="text-xs uppercase tracking-widest text-zinc-400">
          Fecha del primer pago
        </Label>
        <Input
          type="date"
          className="rounded-none border-border focus:ring-1 focus:ring-zinc-900"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          required
        />
      </div>

      {/* Porcentajes */}
      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-widest text-zinc-400">
            Enganche (%)
          </Label>
          <Input
            type="number"
            min="0"
            max="100"
            step="0.01"
            className="rounded-none border-border focus:ring-1 focus:ring-zinc-900 font-mono"
            value={downPct}
            onChange={(e) => setDownPct(e.target.value)}
            required
          />
          <p className="text-xs font-mono text-zinc-400">{fmt(downAmount)}</p>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-widest text-zinc-400">
            Mensualidades
          </Label>
          <Input
            type="number"
            min="0"
            max="360"
            step="1"
            className="rounded-none border-border focus:ring-1 focus:ring-zinc-900 font-mono"
            value={months}
            onChange={(e) => setMonths(e.target.value)}
          />
          {mo > 0 && (
            <p className="text-xs font-mono text-zinc-400">{fmt(monthlyAmount)}/mes</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-widest text-zinc-400">
            Entrega (%)
          </Label>
          <Input
            type="number"
            min="0"
            max="100"
            step="0.01"
            className="rounded-none border-border focus:ring-1 focus:ring-zinc-900 font-mono"
            value={deliveryPct}
            onChange={(e) => setDeliveryPct(e.target.value)}
          />
          {delPct > 0 && (
            <p className="text-xs font-mono text-zinc-400">{fmt(deliveryAmount)}</p>
          )}
        </div>
      </div>

      {/* Verificación total */}
      <div className="flex items-center justify-between text-xs">
        <span className="text-zinc-400">Total verificado:</span>
        <span className={`font-mono font-medium ${diff < 1 ? "text-green-700" : "text-amber-700"}`}>
          {fmt(totalCheck)}
          {diff >= 1 && (
            <span className="ml-2 text-amber-600">(diff {fmt(diff)})</span>
          )}
        </span>
      </div>

      {/* Preview del schedule */}
      {preview.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs uppercase tracking-widest text-zinc-400">
            Preview del plan ({preview.length} pagos)
          </p>
          <div className="border border-border max-h-48 overflow-y-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-zinc-50">
                  <th className="py-2 px-3 text-left font-medium text-zinc-500">#</th>
                  <th className="py-2 px-3 text-left font-medium text-zinc-500">Fecha</th>
                  <th className="py-2 px-3 text-left font-medium text-zinc-500">Concepto</th>
                  <th className="py-2 px-3 text-right font-medium text-zinc-500">Monto</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((row) => (
                  <tr key={row.n} className="border-b border-border last:border-0 hover:bg-zinc-50/50">
                    <td className="py-2 px-3 font-mono text-zinc-400">{row.n}</td>
                    <td className="py-2 px-3 text-zinc-600">{row.date}</td>
                    <td className="py-2 px-3 text-zinc-600">{row.label}</td>
                    <td className="py-2 px-3 text-right font-mono font-medium">{fmt(row.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={loading}>
          Cancelar
        </Button>
        <Button type="submit" disabled={loading || dp <= 0}>
          {loading ? "Creando…" : "Crear plan de pago"}
        </Button>
      </div>
    </form>
  );
}
