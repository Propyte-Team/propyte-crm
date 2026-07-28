// Cliente del Hub — fuente de verdad del inventario (speckit MAESTRO §2.1, Fase 1).
//
// LECTURA de catálogo: SQL directo al esquema real_estate_hub por la MISMA conexión
// Postgres (igual que el sitio web y el bot del CRM). Decisión de Luis 2026-06-12.
// MUTACIÓN de inventario (hold/release/confirm): REST al Hub con header x-hub-api-key.
//
// El CRM NO escribe catálogo. Esta capa aísla el swap futuro a una API REST de lectura
// (solo habría que reimplementar las funciones list/get sin tocar a los callers).
import {
  listPublishedDevelopments,
  getPublishedDevelopment,
  listPublishedUnits,
  getPublishedUnit,
} from "./catalog";
import type { PublishedDevelopment, PublishedUnit } from "./catalog-types";
import type {
  HubDevelopment,
  HubUnit,
  HubHoldResult,
  HubUnitFilters,
  HubDevelopmentFilters,
} from "./types";

const HUB_BASE = process.env.HUB_API_BASE_URL?.replace(/\/$/, "") ?? "";
const HUB_KEY = process.env.HUB_API_KEY?.trim() ?? "";

// ───────────────────────── Lectura (delega en catalog.ts) ─────────────────────────
// El gate público vive en catalog.ts. Aquí solo se adapta al shape legado HubDevelopment /
// HubUnit y se conserva la firma (array / T|null) para no tocar a los 6 callers actuales.

function toHubDevelopment(d: PublishedDevelopment): HubDevelopment {
  return {
    id: d.id,
    nombre: d.name,
    zona: d.zone,
    plaza: d.city,
    status: d.stage,
    precioMin: d.priceMinMxn,
    precioMax: d.priceMaxMxn,
    moneda: d.currency ?? "MXN",
  };
}

function toHubUnit(u: PublishedUnit): HubUnit {
  return {
    id: u.id,
    developmentId: u.developmentId,
    numero: u.unitNumber,
    titulo: u.title,
    tipo: u.unitType,
    tipologia: u.typology,
    recamaras: u.bedrooms,
    banos: u.bathrooms,
    m2Construccion: u.builtAreaM2,
    m2Total: u.areaM2,
    precioMxn: u.priceMxn,
    precioUsd: u.priceUsd,
    moneda: u.currency ?? "MXN",
    status: u.status,
  };
}

export async function listHubDevelopments(
  filters: HubDevelopmentFilters = {}
): Promise<HubDevelopment[]> {
  const { data } = await listPublishedDevelopments({
    search: filters.search ?? null,
    zone: filters.zone ?? null,
    priceMin: filters.budgetMin ?? null,
    priceMax: filters.budgetMax ?? null,
    limit: filters.limit ?? 100,
  });
  return data.map(toHubDevelopment);
}

export async function getHubDevelopment(id: string): Promise<HubDevelopment | null> {
  const { data } = await getPublishedDevelopment(id);
  return data ? toHubDevelopment(data) : null;
}

export async function listHubUnits(filters: HubUnitFilters = {}): Promise<HubUnit[]> {
  const { data } = await listPublishedUnits({
    developmentId: filters.developmentId ?? null,
    search: filters.search ?? null,
    limit: filters.limit ?? 200,
  });
  const units = data.map(toHubUnit);
  // onlyAvailable se resuelve en JS: v_units ya trae solo publicadas y `status` es texto libre.
  return filters.onlyAvailable
    ? units.filter((u) => (u.status ?? "").toLowerCase() === "disponible")
    : units;
}

export async function getHubUnit(id: string): Promise<HubUnit | null> {
  const { data } = await getPublishedUnit(id);
  return data ? toHubUnit(data) : null;
}

// ───────────────────── Mutación de inventario (REST al Hub) ─────────────────────

async function hubInventoryPost(path: string, body: Record<string, unknown>): Promise<HubHoldResult> {
  if (!HUB_BASE || !HUB_KEY) {
    return { ok: false, error: "Hub API no configurada (HUB_API_BASE_URL / HUB_API_KEY)" };
  }
  try {
    const res = await fetch(`${HUB_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-hub-api-key": HUB_KEY },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    const json = (await res.json().catch(() => ({}))) as HubHoldResult;
    if (!res.ok) return { ok: false, error: json?.error ?? `Hub respondió ${res.status}` };
    return { ...json, ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Error de red con el Hub" };
  }
}

/** Solicita hold de una unidad en el Hub (atomicidad la garantiza el Hub). */
export function requestUnitHold(args: { hubUnitId: string; crmDealId: string; ttlHours?: number }): Promise<HubHoldResult> {
  return hubInventoryPost(`/api/inventory/units/${args.hubUnitId}/hold`, {
    crmDealId: args.crmDealId,
    ttlHours: args.ttlHours ?? 72,
  });
}

/** Libera un hold de unidad en el Hub. */
export function releaseUnitHold(args: { hubUnitId: string; crmDealId: string }): Promise<HubHoldResult> {
  return hubInventoryPost(`/api/inventory/units/${args.hubUnitId}/release`, { crmDealId: args.crmDealId });
}

/** Confirma la venta de una unidad en el Hub. */
export function confirmUnitHold(args: { hubUnitId: string; crmDealId: string }): Promise<HubHoldResult> {
  return hubInventoryPost(`/api/inventory/units/${args.hubUnitId}/confirm`, { crmDealId: args.crmDealId });
}
