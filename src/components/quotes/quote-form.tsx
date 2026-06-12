"use client";

// ============================================================
// QuoteForm — Crear / editar cotización
// ============================================================

import { useState, useEffect } from "react";
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

  // Selector de unidad del Hub (T3.1): búsqueda + auto-llenado de precio/moneda.
  const [unitSearch, setUnitSearch] = useState("");
  const [unitResults, setUnitResults] = useState<Array<{ id: string; unitNumber: string; unitType: string; price: number; moneda: string }>>([]);
  const [pickedUnit, setPickedUnit] = useState<string | null>(initial?.hubUnitId ?? null);
  const [unitOpen, setUnitOpen] = useState(false);

  useEffect(() => {
    if (!unitSearch || unitSearch.length < 2) { setUnitResults([]); return; }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/hub/units?search=${encodeURIComponent(unitSearch)}&onlyAvailable=true&limit=20`);
        if (res.ok) setUnitResults((await res.json()).data ?? []);
      } catch { /* defensivo */ }
    }, 300);
    return () => clearTimeout(t);
  }, [unitSearch]);

  function pickUnit(u: { id: string; unitNumber: string; unitType: string; price: number; moneda: string }) {
    setHubUnitId(u.id);
    setPickedUnit(`${u.unitNumber} · ${u.unitType}`);
    if (u.price) setListPrice(String(u.price));
    if (u.moneda === "MXN" || u.moneda === "USD") setCurrency(u.moneda);
    setUnitOpen(false);
    setUnitSearch("");
    setUnitResults([]);
  }

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

      {/* Unidad del Hub — selector con búsqueda (T3.1) */}
      <div className="space-y-1.5">
        <Label className="text-xs uppercase tracking-widest text-zinc-400">
          Unidad (Hub) <span className="normal-case">(opcional)</span>
        </Label>
        {pickedUnit ? (
          <div className="flex items-center justify-between border border-border px-3 py-2 text-sm">
            <span>{pickedUnit}</span>
            <button
              type="button"
              className="text-xs text-zinc-400 hover:text-zinc-900"
              onClick={() => { setPickedUnit(null); setHubUnitId(""); setUnitOpen(true); }}
            >
              Cambiar
            </button>
          </div>
        ) : (
          <div className="relative">
            <Input
              className="rounded-none border-border focus:ring-1 focus:ring-zinc-900"
              placeholder="Buscar unidad del Hub por número o título…"
              value={unitSearch}
              onFocus={() => setUnitOpen(true)}
              onChange={(e) => { setUnitSearch(e.target.value); setUnitOpen(true); }}
            />
            {unitOpen && unitResults.length > 0 && (
              <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto border border-border bg-white text-sm shadow-sm">
                {unitResults.map((u) => (
                  <li key={u.id}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-zinc-50"
                      onClick={() => pickUnit(u)}
                    >
                      <span>{u.unitNumber} · {u.unitType}</span>
                      <span className="font-mono text-xs text-zinc-500">
                        {u.price ? `$${Number(u.price).toLocaleString("es-MX")} ${u.moneda}` : ""}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {unitOpen && unitSearch.length >= 2 && unitResults.length === 0 && (
              <p className="mt-1 text-xs text-zinc-400">Sin unidades disponibles que coincidan.</p>
            )}
          </div>
        )}
        <p className="text-[11px] text-zinc-400">
          Al elegir una unidad se congela su precio y moneda del Hub en la cotización.
        </p>
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
