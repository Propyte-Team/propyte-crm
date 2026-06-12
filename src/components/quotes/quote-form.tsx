"use client";

// ============================================================
// QuoteForm — Crear / editar cotización
// ============================================================

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const SCHEME_LABEL: Record<string, string> = {
  CONTADO: "Contado",
  FINANCIAMIENTO_DIRECTO: "Financiamiento directo",
  CREDITO_BANCARIO: "Crédito bancario",
  MIXTO: "Mixto",
};

interface QuoteFormProps {
  dealId: string;
  initial?: {
    id?: string;
    hubUnitId?: string | null;
    currency?: "MXN" | "USD";
    listPrice?: number;
    discountPct?: number;
    scheme?: string;
    notes?: string | null;
    expiresAt?: string | null;
    fxRate?: number | null;
  };
  onSuccess: (quote: any) => void;
  onCancel: () => void;
}

export function QuoteForm({ dealId, initial, onSuccess, onCancel }: QuoteFormProps) {
  const isEdit = !!initial?.id;

  const [currency, setCurrency] = useState<"MXN" | "USD">(initial?.currency ?? "MXN");
  const [listPrice, setListPrice] = useState(String(initial?.listPrice ?? ""));
  const [discountPct, setDiscountPct] = useState(String(initial?.discountPct ?? "0"));
  const [scheme, setScheme] = useState(initial?.scheme ?? "FINANCIAMIENTO_DIRECTO");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [expiresAt, setExpiresAt] = useState(
    initial?.expiresAt ? initial.expiresAt.slice(0, 10) : ""
  );
  const [fxRate, setFxRate] = useState(String(initial?.fxRate ?? ""));
  const [hubUnitId, setHubUnitId] = useState(initial?.hubUnitId ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lp = parseFloat(listPrice) || 0;
  const dp = parseFloat(discountPct) || 0;
  const finalPrice = lp * (1 - dp / 100);

  const formatMoney = (v: number) =>
    new Intl.NumberFormat("es-MX", { style: "currency", currency }).format(v);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!listPrice || lp <= 0) {
      setError("El precio de lista debe ser mayor a 0");
      return;
    }

    setLoading(true);
    try {
      const payload = {
        dealId,
        hubUnitId: hubUnitId || null,
        currency,
        listPrice: lp,
        discountPct: dp,
        scheme,
        notes: notes || null,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        fxRate: fxRate ? parseFloat(fxRate) : null,
      };

      const url = isEdit ? `/api/quotes/${initial!.id}` : "/api/quotes";
      const method = isEdit ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Error desconocido");
        return;
      }

      onSuccess(json.data);
    } catch {
      setError("Error al guardar cotización");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Moneda y tipo de cambio */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-widest text-zinc-400">Moneda</Label>
          <Select value={currency} onValueChange={(v) => setCurrency(v as "MXN" | "USD")}>
            <SelectTrigger className="rounded-none border-border focus:ring-1 focus:ring-zinc-900">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="MXN">MXN — Peso mexicano</SelectItem>
              <SelectItem value="USD">USD — Dólar</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {currency === "USD" && (
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-widest text-zinc-400">
              Tipo de cambio (MXN/USD)
            </Label>
            <Input
              className="rounded-none border-border focus:ring-1 focus:ring-zinc-900 font-mono"
              placeholder="17.50"
              value={fxRate}
              onChange={(e) => setFxRate(e.target.value)}
              type="number"
              min="1"
              step="0.0001"
            />
          </div>
        )}
      </div>

      {/* Hub Unit ID */}
      <div className="space-y-1.5">
        <Label className="text-xs uppercase tracking-widest text-zinc-400">
          ID Unidad (Hub) <span className="normal-case">(opcional)</span>
        </Label>
        <Input
          className="rounded-none border-border focus:ring-1 focus:ring-zinc-900"
          placeholder="uuid de la unidad en Hub Propyte"
          value={hubUnitId}
          onChange={(e) => setHubUnitId(e.target.value)}
        />
      </div>

      {/* Precio lista y descuento */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-widest text-zinc-400">
            Precio de lista
          </Label>
          <Input
            className="rounded-none border-border focus:ring-1 focus:ring-zinc-900 font-mono"
            required
            placeholder="0.00"
            value={listPrice}
            onChange={(e) => setListPrice(e.target.value)}
            type="number"
            min="0"
            step="0.01"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-widest text-zinc-400">
            Descuento (%)
          </Label>
          <Input
            className="rounded-none border-border focus:ring-1 focus:ring-zinc-900 font-mono"
            placeholder="0"
            value={discountPct}
            onChange={(e) => setDiscountPct(e.target.value)}
            type="number"
            min="0"
            max="100"
            step="0.01"
          />
        </div>
      </div>

      {/* Precio final calculado */}
      {lp > 0 && (
        <div className="flex items-center justify-between rounded-none border border-dashed border-zinc-200 bg-zinc-50 px-4 py-3">
          <span className="text-xs uppercase tracking-widest text-zinc-400">Precio final</span>
          <span className="font-mono text-lg font-semibold text-zinc-900">
            {formatMoney(finalPrice)}
          </span>
        </div>
      )}

      {/* Esquema de pago */}
      <div className="space-y-1.5">
        <Label className="text-xs uppercase tracking-widest text-zinc-400">
          Esquema de pago
        </Label>
        <Select value={scheme} onValueChange={setScheme}>
          <SelectTrigger className="rounded-none border-border focus:ring-1 focus:ring-zinc-900">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(SCHEME_LABEL).map(([k, v]) => (
              <SelectItem key={k} value={k}>
                {v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Vencimiento */}
      <div className="space-y-1.5">
        <Label className="text-xs uppercase tracking-widest text-zinc-400">
          Vence el <span className="normal-case">(opcional)</span>
        </Label>
        <Input
          className="rounded-none border-border focus:ring-1 focus:ring-zinc-900"
          type="date"
          value={expiresAt}
          onChange={(e) => setExpiresAt(e.target.value)}
        />
      </div>

      {/* Notas */}
      <div className="space-y-1.5">
        <Label className="text-xs uppercase tracking-widest text-zinc-400">Notas</Label>
        <textarea
          className="w-full rounded-none border border-border bg-white px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-zinc-900"
          rows={3}
          placeholder="Condiciones especiales, observaciones…"
          value={notes}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setNotes(e.target.value)}
        />
      </div>

      {error && (
        <p className="text-sm text-red-600">{error}</p>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={loading}>
          Cancelar
        </Button>
        <Button type="submit" disabled={loading}>
          {loading ? "Guardando…" : isEdit ? "Guardar cambios" : "Crear cotización"}
        </Button>
      </div>
    </form>
  );
}
