/**
 * Resuelve el FK id_desarrollador a partir del string `developer_name`:
 *  1. Si existe match exacto case-insensitive en Propyte_desarrolladores → reusa
 *  2. Si existe match con pg_trgm similarity > 0.8 → reusa (ej "Mundo Constructor" == "Mundo Constructora")
 *  3. Si no → INSERT nuevo y retorna id
 *
 * En dry-run: solo LEE (match existente), retorna fake id si habria que INSERT.
 *
 * `developer_name` es SENSITIVE (puede venir de rival) — este dedup solo se
 * debe invocar con candidates que ya pasaron el tie-breaker de status=published.
 */

import { getDb } from "../shared/db";
import { upsertReturningId, type DryRunContext } from "../shared/dry-run";

export interface DeveloperResolution {
  id: string;
  method: "existing_exact" | "existing_similar" | "inserted";
  similarity?: number;
  canonicalName: string;
}

/**
 * Cache in-memory por robot run para evitar queries duplicados.
 * Key: developer_name normalizado.
 */
const cache = new Map<string, DeveloperResolution>();

export function __resetDevCache(): void {
  cache.clear();
}

function normalize(name: string): string {
  return name.trim().toLowerCase();
}

export async function resolveDeveloper(
  ctx: DryRunContext,
  developerName: string | null | undefined
): Promise<DeveloperResolution | null> {
  if (!developerName || developerName.trim().length === 0) return null;

  const normalized = normalize(developerName);
  const cached = cache.get(normalized);
  if (cached) return cached;

  const db = getDb();

  // 1. Exact match case-insensitive (contra deleted_at IS NULL)
  const exact = (await db.$queryRawUnsafe(
    `SELECT id::text, nombre_desarrollador
     FROM real_estate_hub."Propyte_desarrolladores"
     WHERE lower(nombre_desarrollador) = $1 AND deleted_at IS NULL
     LIMIT 1`,
    normalized
  )) as Array<{ id: string; nombre_desarrollador: string }>;

  if (exact.length > 0) {
    const result: DeveloperResolution = {
      id: exact[0].id,
      method: "existing_exact",
      canonicalName: exact[0].nombre_desarrollador,
    };
    cache.set(normalized, result);
    return result;
  }

  // 2. pg_trgm similarity > 0.8
  const similar = (await db.$queryRawUnsafe(
    `SELECT id::text, nombre_desarrollador,
            similarity(nombre_desarrollador, $1::text) as sim
     FROM real_estate_hub."Propyte_desarrolladores"
     WHERE deleted_at IS NULL
       AND similarity(nombre_desarrollador, $1::text) > 0.8
     ORDER BY sim DESC
     LIMIT 1`,
    developerName
  )) as Array<{ id: string; nombre_desarrollador: string; sim: number }>;

  if (similar.length > 0) {
    const result: DeveloperResolution = {
      id: similar[0].id,
      method: "existing_similar",
      similarity: similar[0].sim,
      canonicalName: similar[0].nombre_desarrollador,
    };
    cache.set(normalized, result);
    return result;
  }

  // 3. Insert nuevo
  const id = await upsertReturningId(
    ctx,
    `insert desarrollador "${developerName}"`,
    `INSERT INTO real_estate_hub."Propyte_desarrolladores" (nombre_desarrollador)
     VALUES ($1)
     ON CONFLICT (lower(nombre_desarrollador)) WHERE deleted_at IS NULL
     DO UPDATE SET nombre_desarrollador = EXCLUDED.nombre_desarrollador
     RETURNING id::text`,
    [developerName.trim()],
    `dev:${normalized}`
  );

  const result: DeveloperResolution = {
    id,
    method: "inserted",
    canonicalName: developerName.trim(),
  };
  cache.set(normalized, result);
  return result;
}
