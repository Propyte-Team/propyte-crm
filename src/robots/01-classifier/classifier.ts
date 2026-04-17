/**
 * Classifier: agrupa public.properties por development_name normalizado.
 *
 * Filtro: status IN ('review','published') AND content_hash IS NOT NULL.
 * (status != 'possible_duplicate' implicito porque no esta en el IN)
 *
 * Las properties sin development_name van al grupo especial __NO_DEV__ →
 * se crean unidades sueltas sin FK desarrollo.
 */

import { selectRows } from "../shared/dry-run";
import type { PublicProperty } from "../shared/types";

export const NO_DEV_KEY = "__NO_DEV__";

/**
 * Normaliza development_name para agrupar:
 *  - trim
 *  - lowercase
 *  - colapsa whitespace interno
 *  - remueve acentos (NFD + filter combining)
 *  - remueve caracteres especiales excepto espacios y alfanumericos
 */
export function normalizeDevName(name: string | null | undefined): string {
  if (!name) return NO_DEV_KEY;
  const trimmed = name.trim();
  if (trimmed.length === 0) return NO_DEV_KEY;

  return trimmed
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // combining marks
    .replace(/[^\w\s]/g, " ") // punctuation -> space
    .replace(/\s+/g, " ") // collapse spaces
    .trim();
}

export interface DevelopmentGroup {
  key: string; // normalized name, or NO_DEV_KEY
  displayName: string; // el nombre original mas "fresco" (published gana, luego mas reciente)
  properties: PublicProperty[];
}

/**
 * Lee properties admisibles desde public.* y las agrupa por development_name normalizado.
 *
 * Orden del SELECT: por development_name ASC + published_at DESC NULLS LAST
 * (para que el "displayName" sea consistente entre corridas)
 */
export async function fetchAndGroup(opts: {
  limit?: number | null;
  sourceDomain?: string | null;
  developmentName?: string | null;
}): Promise<DevelopmentGroup[]> {
  const whereClauses = [
    `p.status IN ('review', 'published')`,
    `p.status != 'possible_duplicate'`,
    `p.content_hash IS NOT NULL`,
  ];
  const params: unknown[] = [];

  if (opts.sourceDomain) {
    params.push(`%${opts.sourceDomain}%`);
    whereClauses.push(`s.domain ILIKE $${params.length}`);
  }
  if (opts.developmentName) {
    params.push(opts.developmentName);
    whereClauses.push(`p.development_name = $${params.length}`);
  }

  const limitClause = opts.limit ? `LIMIT ${opts.limit}` : "";

  const sql = `
    SELECT p.*, s.domain as source_domain
    FROM public.properties p
    JOIN public.sources s ON s.id = p.source_id
    WHERE ${whereClauses.join(" AND ")}
    ORDER BY p.development_name ASC NULLS LAST, p.published_at DESC NULLS LAST, p.last_seen_at DESC
    ${limitClause}
  `;

  const rows = await selectRows<PublicProperty & { source_domain: string }>(sql, ...params);

  const groups = new Map<string, DevelopmentGroup>();

  for (const p of rows) {
    const key = normalizeDevName(p.development_name);

    if (!groups.has(key)) {
      groups.set(key, {
        key,
        displayName: p.development_name ?? NO_DEV_KEY,
        properties: [],
      });
    }
    const group = groups.get(key)!;
    group.properties.push(p);

    // Preserva el displayName de la property mas "fresca" con development_name no-null
    if (key !== NO_DEV_KEY && p.development_name) {
      const currentIsPublished = p.status === "published";
      const existingDisplayProperty = group.properties.find(
        (q) => q.development_name === group.displayName
      );
      const existingIsPublished = existingDisplayProperty?.status === "published";

      if (currentIsPublished && !existingIsPublished) {
        group.displayName = p.development_name;
      }
    }
  }

  return Array.from(groups.values());
}
