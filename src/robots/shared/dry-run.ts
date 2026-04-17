/**
 * Helper para dry-run: intercepta writes y los loggea en lugar de ejecutarlos.
 *
 * Simpler que un Proxy sobre PrismaClient: los robots llaman a estas funciones
 * helper en vez de $executeRawUnsafe directo. Si opts.dryRun=true, solo log.
 */

import { getDb } from "./db";
import type { RobotLogger } from "./logger";

export interface DryRunContext {
  dryRun: boolean;
  logger: RobotLogger;
}

/**
 * Ejecuta un INSERT/UPDATE/UPSERT con retry de dry-run.
 * En dry-run: loggea el SQL + params y retorna null (el caller debe manejar null).
 * En real-run: ejecuta y retorna rowCount.
 */
export async function execWrite(
  ctx: DryRunContext,
  label: string,
  sql: string,
  params: unknown[]
): Promise<number | null> {
  if (ctx.dryRun) {
    const preview = sql.replace(/\s+/g, " ").slice(0, 120);
    ctx.logger.info(`[dry-run] ${label}: ${preview}`, {
      params: params.map((p) => {
        if (p == null) return null;
        if (typeof p === "string" && p.length > 60) return p.slice(0, 60) + "...";
        return p;
      }),
    });
    return null;
  }

  const db = getDb();
  const rowCount = await db.$executeRawUnsafe(sql, ...params);
  return rowCount;
}

/**
 * Ejecuta un SELECT y retorna resultados tipados.
 * En dry-run NO se simula (los reads son seguros).
 */
export async function selectRows<T>(sql: string, ...params: unknown[]): Promise<T[]> {
  const db = getDb();
  return (await db.$queryRawUnsafe(sql, ...params)) as T[];
}

/**
 * Ejecuta un UPSERT con RETURNING id. En dry-run retorna un UUID fake determinista
 * basado en una clave (para que el resto del flujo no explote en dry-run).
 */
export async function upsertReturningId(
  ctx: DryRunContext,
  label: string,
  sql: string,
  params: unknown[],
  fakeIdKey: string
): Promise<string> {
  if (ctx.dryRun) {
    const fakeId = fakeUuidFromKey(fakeIdKey);
    ctx.logger.info(`[dry-run] ${label} -> fake id=${fakeId}`, {
      params: params.slice(0, 3), // no log todo, muy verboso
    });
    return fakeId;
  }

  const db = getDb();
  const rows = (await db.$queryRawUnsafe<{ id: string }[]>(sql, ...params)) as { id: string }[];
  if (!rows[0]?.id) {
    throw new Error(`upsertReturningId: ${label} no devolvio id`);
  }
  return rows[0].id;
}

/**
 * Genera un UUID determinista desde un string (solo para dry-run).
 * Formato: 00000000-xxxx-xxxx-xxxx-xxxxxxxxxxxx donde x es hash(key)
 */
function fakeUuidFromKey(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash << 5) - hash + key.charCodeAt(i);
    hash |= 0;
  }
  const hex = (Math.abs(hash).toString(16) + "0".repeat(24)).slice(0, 24);
  return `dryrun00-${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 24)}`;
}
