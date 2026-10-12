// Badge de marca y selector «Marca» de las listas (2026-10-12, entrega 3 de marcas).
// La regla vive en @/lib/brands/badges (pura); aquí solo se pinta. El contexto lo arma cada
// página en el servidor (getBrandViewContext) y lo pasa con <BrandViewProvider>, para no
// arrastrar las marcas prop por prop hasta la tarjeta del tablero.
"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { brandBadges, EMPTY_BRAND_VIEW, type BrandViewContext } from "@/lib/brands/badges";
import { BRAND_FILTER_PARAM } from "@/lib/brands/filter";
import { cn } from "@/lib/utils";

const BrandViewCtx = createContext<BrandViewContext>(EMPTY_BRAND_VIEW);

export function BrandViewProvider({ value, children }: { value: BrandViewContext; children: ReactNode }) {
  return <BrandViewCtx.Provider value={value}>{children}</BrandViewCtx.Provider>;
}

export function useBrandView(): BrandViewContext {
  return useContext(BrandViewCtx);
}

/**
 * Badges de marca de un registro. No pinta nada cuando no aporta (ver brandBadges).
 * @param brandIds filas de contact_brands (`[]` = predeterminada) o la marca de la cuenta del hilo.
 * @param alreadyShown nombre que ya se ve junto al registro (etiqueta de la cuenta en la bandeja).
 */
export function BrandBadges({
  brandIds,
  alreadyShown,
  className,
}: {
  brandIds: readonly string[] | null | undefined;
  alreadyShown?: string | null;
  className?: string;
}) {
  const ctx = useBrandView();
  const list = brandBadges(brandIds, ctx, { alreadyShown });
  if (list.length === 0) return null;
  return (
    <>
      {list.map((b) => (
        <span
          key={b.id}
          title={`Marca: ${b.name}`}
          className={cn(
            "inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-1.5 text-[10px] font-medium leading-4 text-muted-foreground",
            className
          )}
        >
          {b.name}
        </span>
      ))}
    </>
  );
}

/**
 * Marca elegida en la lista, guardada en `?marca=` como los demás filtros de URL de la app.
 * Un valor que no está entre las opciones del usuario (marca ajena, borrada o inventada en la URL)
 * se lee como «Todas mis marcas»: el servidor ya lo ignoró al pintar la primera página.
 * Se cambia la URL con history.replaceState (Next la sincroniza con useSearchParams) para no
 * volver a pedir la página al servidor cada vez que se mueve el selector.
 */
export function useBrandFilterParam(): [string | null, (brandId: string | null) => void] {
  const { options } = useBrandView();
  const searchParams = useSearchParams();
  const [value, setValue] = useState<string | null>(() => {
    const raw = searchParams.get(BRAND_FILTER_PARAM);
    return raw && options.some((o) => o.id === raw) ? raw : null;
  });

  const update = useCallback((brandId: string | null) => {
    setValue(brandId);
    const params = new URLSearchParams(window.location.search);
    if (brandId) params.set(BRAND_FILTER_PARAM, brandId);
    else params.delete(BRAND_FILTER_PARAM);
    const qs = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }, []);

  return [value, update];
}

/**
 * Selector «Marca»: «Todas mis marcas» + cada marca que el usuario ve. Solo aparece si ve más de
 * una; con una sola no hay nada que acotar.
 */
export function BrandFilterSelect({
  value,
  onChange,
  className,
}: {
  value: string | null;
  onChange: (brandId: string | null) => void;
  className?: string;
}) {
  const { options, multiBrand } = useBrandView();
  if (!multiBrand) return null;
  return (
    <select
      aria-label="Filtrar por marca"
      className={className}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
    >
      <option value="">Todas mis marcas</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );
}
