/**
 * Resuelve el FK id_desarrollador a partir del string `developer_name`:
 *  1. Verifica que el nombre NO esté en la blacklist de brokers/agencias
 *  2. Si existe match exacto case-insensitive en Propyte_desarrolladores → reusa
 *  3. Si existe match con pg_trgm similarity > 0.8 → reusa
 *  4. Si no existe match → retorna null (NUNCA inserta nuevos)
 *
 * Los desarrolladores se agregan MANUALMENTE después de verificar.
 * El robot solo vincula con desarrolladores que ya existen en la tabla.
 *
 * `developer_name` es SENSITIVE (puede venir de rival) — este dedup solo se
 * debe invocar con candidates que ya pasaron el tie-breaker de status=published.
 */

import { getDb } from "../shared/db";
import { isDeveloperBlacklisted } from "../shared/developer-blacklist";
import type { DryRunContext } from "../shared/dry-run";

export interface DeveloperResolution {
  id: string;
  method: "existing_exact" | "existing_similar" | "blacklisted" | "no_match";
  similarity?: number;
  canonicalName: string;
}

/**
 * Cache in-memory por robot run para evitar queries duplicados.
 * Key: developer_name normalizado.
 */
const cache = new Map<string, DeveloperResolution | null>();

/** Contador de nombres blacklisted para métricas */
let blacklistedCount = 0;
/** Contador de nombres sin match para métricas */
let noMatchCount = 0;
/** Nombres únicos descartados por blacklist */
const blacklistedNames = new Set<string>();
/** Nombres únicos sin match (candidatos a verificar manualmente) */
const noMatchNames = new Set<string>();

export function __resetDevCache(): void {
  cache.clear();
  blacklistedCount = 0;
  noMatchCount = 0;
  blacklistedNames.clear();
  noMatchNames.clear();
}

export function getDevStats(): {
  blacklistedCount: number;
  noMatchCount: number;
  blacklistedNames: string[];
  noMatchNames: string[];
} {
  return {
    blacklistedCount,
    noMatchCount,
    blacklistedNames: [...blacklistedNames],
    noMatchNames: [...noMatchNames],
  };
}

function normalize(name: string): string {
  return name.trim().toLowerCase();
}

export async function resolveDeveloper(
  _ctx: DryRunContext,
  developerName: string | null | undefined
): Promise<DeveloperResolution | null> {
  if (!developerName || developerName.trim().length === 0) return null;

  const normalized = normalize(developerName);

  // Check cache (puede ser null = ya procesado y descartado)
  if (cache.has(normalized)) return cache.get(normalized) ?? null;

  // 1. Blacklist check — brokers, agencias, fuentes
  if (isDeveloperBlacklisted(developerName)) {
    blacklistedCount++;
    blacklistedNames.add(developerName.trim());
    cache.set(normalized, null);
    return null;
  }

  const db = getDb();

  // 2. Exact match case-insensitive (contra deleted_at IS NULL)
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

  // 3. pg_trgm similarity > 0.8
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

  // 4. No match → NO insertar. Queda NULL hasta que se verifique manualmente.
  noMatchCount++;
  noMatchNames.add(developerName.trim());
  cache.set(normalized, null);
  return null;
}
