// Selector de "Marca del agente" para una cuenta de Conexiones (2026-10-09, spec marcas-agente).
// Lo usan el asistente de conexión (cuenta nueva) y la lista de cuentas (cambiar la marca de una
// existente). Lista solo las marcas NO predeterminadas: "Predeterminada (Propyte)" equivale a no
// tener marca (`brandId: null`), que es lo que ya hacían todas las cuentas antes de las marcas.
"use client";

import { useEffect, useState } from "react";

export interface BrandOption {
  id: string;
  name: string;
}

/** Marcas no predeterminadas, cargadas de GET /api/admin/brands (lo leen también MARKETING). */
export function useBrandOptions(enabled: boolean): BrandOption[] {
  const [brands, setBrands] = useState<BrandOption[]>([]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/brands");
        if (!res.ok) return;
        const data = await res.json().catch(() => ({}));
        if (cancelled || !Array.isArray(data.data)) return;
        setBrands(
          data.data
            .filter((b: { isDefault?: boolean }) => !b.isDefault)
            .map((b: { id: string; name: string }) => ({ id: b.id, name: b.name }))
        );
      } catch {
        // Sin marcas cargadas el selector solo ofrece "Predeterminada": la cuenta sigue funcionando.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return brands;
}

export function BrandSelect({
  id, value, onChange, brands, current, disabled,
}: {
  id: string;
  /** brandId actual; null = Predeterminada. */
  value: string | null;
  onChange: (brandId: string | null) => void;
  brands: BrandOption[];
  /** La marca ya asignada a la cuenta: se ofrece aunque no esté en `brands` (p. ej. borrada). */
  current?: BrandOption | null;
  disabled?: boolean;
}) {
  const extra = current && !brands.some((b) => b.id === current.id) ? current : null;
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-[10px] uppercase tracking-wide text-muted-foreground">
        Marca del agente
      </label>
      <select
        id={id}
        className="form-input w-full"
        value={value ?? ""}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">Predeterminada (Propyte)</option>
        {extra && <option value={extra.id}>{extra.name}</option>}
        {brands.map((b) => (
          <option key={b.id} value={b.id}>{b.name}</option>
        ))}
      </select>
      <p className="text-[10px] text-muted-foreground">
        Define con qué marca responde el agente en esta cuenta y a qué marca se atribuyen sus leads.
      </p>
    </div>
  );
}
