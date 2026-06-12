// Cliente del Hub — fuente de verdad del inventario (speckit MAESTRO §2.1, Fase 1).
//
// LECTURA de catálogo: SQL directo al esquema real_estate_hub por la MISMA conexión
// Postgres (igual que el sitio web y el bot del CRM). Decisión de Luis 2026-06-12.
// MUTACIÓN de inventario (hold/release/confirm): REST al Hub con header x-hub-api-key.
//
// El CRM NO escribe catálogo. Esta capa aísla el swap futuro a una API REST de lectura
// (solo habría que reimplementar las funciones list/get sin tocar a los callers).
import prisma from "@/lib/db";
import type {
  HubDevelopment,
  HubUnit,
  HubHoldResult,
  HubUnitFilters,
  HubDevelopmentFilters,
} from "./types";

const HUB_BASE = process.env.HUB_API_BASE_URL?.replace(/\/$/, "") ?? "";
const HUB_KEY = process.env.HUB_API_KEY?.trim() ?? "";

// ───────────────────────── Lectura (SQL directo) ─────────────────────────

export async function listHubDevelopments(
  filters: HubDevelopmentFilters = {}
): Promise<HubDevelopment[]> {
  const limit = Math.min(filters.limit ?? 100, 200);
  try {
    return await prisma.$queryRawUnsafe<HubDevelopment[]>(
      `SELECT d.id::text AS id,
              d.nombre_desarrollo AS nombre,
              d.zona AS zona,
              NULL::text AS plaza,
              d.pipeline_status AS status,
              d.ext_precio_min_mxn::float8 AS "precioMin",
              d.ext_precio_max_mxn::float8 AS "precioMax",
              'MXN' AS moneda
         FROM real_estate_hub."Propyte_desarrollos" d
        WHERE d.pipeline_status::text = 'Publicado'
          AND ($1::text IS NULL OR d.nombre_desarrollo ILIKE '%' || $1 || '%')
          AND ($2::text IS NULL OR d.zona ILIKE '%' || $2 || '%')
          AND ($3::float8 IS NULL OR d.ext_precio_max_mxn >= $3)
          AND ($4::float8 IS NULL OR d.ext_precio_min_mxn <= $4)
        ORDER BY d.nombre_desarrollo ASC
        LIMIT ${limit}`,
      filters.search ?? null,
      filters.zone ?? null,
      filters.budgetMin ?? null,
      filters.budgetMax ?? null
    );
  } catch (err) {
    console.error("[hub/client] listHubDevelopments falló:", err);
    return [];
  }
}

export async function getHubDevelopment(id: string): Promise<HubDevelopment | null> {
  try {
    const rows = await prisma.$queryRawUnsafe<HubDevelopment[]>(
      `SELECT d.id::text AS id,
              d.nombre_desarrollo AS nombre,
              d.zona AS zona,
              NULL::text AS plaza,
              d.pipeline_status AS status,
              d.ext_precio_min_mxn::float8 AS "precioMin",
              d.ext_precio_max_mxn::float8 AS "precioMax",
              'MXN' AS moneda
         FROM real_estate_hub."Propyte_desarrollos" d
        WHERE d.id::text = $1
        LIMIT 1`,
      id
    );
    return rows[0] ?? null;
  } catch (err) {
    console.error("[hub/client] getHubDevelopment falló:", err);
    return null;
  }
}

export async function listHubUnits(filters: HubUnitFilters = {}): Promise<HubUnit[]> {
  const limit = Math.min(filters.limit ?? 200, 500);
  try {
    return await prisma.$queryRawUnsafe<HubUnit[]>(
      `SELECT u.id::text AS id,
              u.id_desarrollo::text AS "developmentId",
              u.ext_numero_unidad AS numero,
              u.titulo_unidad AS titulo,
              u.tipo_unidad AS tipo,
              u.ext_tipologia AS tipologia,
              u.recamaras::int AS recamaras,
              u.banos_completos::int AS banos,
              u.superficie_construida_m2::float8 AS "m2Construccion",
              u.superficie_total_m2::float8 AS "m2Total",
              u.precio_mxn::float8 AS "precioMxn",
              u.precio_usd::float8 AS "precioUsd",
              COALESCE(u.moneda_principal, 'MXN') AS moneda,
              u.estado_unidad AS status
         FROM real_estate_hub."Propyte_unidades" u
        WHERE ($1::text IS NULL OR u.id_desarrollo::text = $1)
          AND ($2::text IS NULL OR u.titulo_unidad ILIKE '%' || $2 || '%' OR u.ext_numero_unidad ILIKE '%' || $2 || '%')
          AND ($3::bool IS NOT TRUE OR u.estado_unidad::text ILIKE 'disponible')
        ORDER BY u.ext_numero_unidad ASC NULLS LAST
        LIMIT ${limit}`,
      filters.developmentId ?? null,
      filters.search ?? null,
      filters.onlyAvailable ?? null
    );
  } catch (err) {
    console.error("[hub/client] listHubUnits falló:", err);
    return [];
  }
}

export async function getHubUnit(id: string): Promise<HubUnit | null> {
  try {
    const rows = await prisma.$queryRawUnsafe<HubUnit[]>(
      `SELECT u.id::text AS id,
              u.id_desarrollo::text AS "developmentId",
              u.ext_numero_unidad AS numero,
              u.titulo_unidad AS titulo,
              u.tipo_unidad AS tipo,
              u.ext_tipologia AS tipologia,
              u.recamaras::int AS recamaras,
              u.banos_completos::int AS banos,
              u.superficie_construida_m2::float8 AS "m2Construccion",
              u.superficie_total_m2::float8 AS "m2Total",
              u.precio_mxn::float8 AS "precioMxn",
              u.precio_usd::float8 AS "precioUsd",
              COALESCE(u.moneda_principal, 'MXN') AS moneda,
              u.estado_unidad AS status
         FROM real_estate_hub."Propyte_unidades" u
        WHERE u.id::text = $1
        LIMIT 1`,
      id
    );
    return rows[0] ?? null;
  } catch (err) {
    console.error("[hub/client] getHubUnit falló:", err);
    return null;
  }
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
