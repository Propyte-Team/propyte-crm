/**
 * Robot 04 - Geo Enrichment
 *
 * Para Propyte_desarrollos y Propyte_unidades sin latitud/longitud, geocodifica
 * via Nominatim OpenStreetMap usando la direccion (municipio + estado + pais).
 *
 * Nominatim policy:
 *  - Max 1 req/seg (rate limit estricto)
 *  - User-Agent obligatorio
 *  - No comercial masivo sin auto-hosteo
 *
 * Para datasets grandes, considerar self-hosted Nominatim o Google Geocoding API.
 *
 * Uso:
 *   npx tsx src/robots/04-geo/run.ts --dry-run --limit 5
 *   npx tsx src/robots/04-geo/run.ts
 */

import { closeDb, getDb } from "../shared/db";
import { parseCli } from "../shared/cli";
import { RobotLogger } from "../shared/logger";
import { execWrite, type DryRunContext } from "../shared/dry-run";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "propyte-robots/1.0 (contact@propyte.com)";
const RATE_LIMIT_MS = 1100; // 1 req / seg + margen

interface GeoTarget {
  id: string;
  municipio: string | null;
  ciudad: string | null;
  estado: string | null;
  pais: string | null;
  colonia: string | null;
}

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
  importance?: number;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildQuery(t: GeoTarget): string {
  const parts: string[] = [];
  if (t.colonia) parts.push(t.colonia);
  if (t.municipio) parts.push(t.municipio);
  else if (t.ciudad) parts.push(t.ciudad);
  if (t.estado) parts.push(t.estado);
  parts.push(t.pais ?? "Mexico");
  return parts.filter(Boolean).join(", ");
}

async function geocode(query: string): Promise<{ lat: number; lon: number } | null> {
  const url = `${NOMINATIM_URL}?q=${encodeURIComponent(query)}&format=json&limit=1&countrycodes=mx`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
      "Accept-Language": "es",
    },
  });
  if (!res.ok) {
    throw new Error(`Nominatim ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as NominatimResult[];
  if (json.length === 0) return null;
  const lat = parseFloat(json[0].lat);
  const lon = parseFloat(json[0].lon);
  if (isNaN(lat) || isNaN(lon)) return null;
  return { lat, lon };
}

async function fetchTargets(table: "desarrollos" | "unidades", limit: number | null): Promise<GeoTarget[]> {
  const db = getDb();
  const limitClause = limit ? `LIMIT ${limit}` : "";

  if (table === "desarrollos") {
    return (await db.$queryRawUnsafe<GeoTarget[]>(
      `SELECT id::text as id, municipio, ciudad, estado, pais, colonia
       FROM real_estate_hub."Propyte_desarrollos"
       WHERE latitud IS NULL
         AND (municipio IS NOT NULL OR ciudad IS NOT NULL OR colonia IS NOT NULL)
         AND deleted_at IS NULL
       ORDER BY updated_at DESC
       ${limitClause}`
    )) as GeoTarget[];
  }
  // Unidades: solo las que no tienen desarrollo (sueltas) con datos propios de direccion.
  // Las unidades con desarrollo heredan el geo del desarrollo — no se geocodifican directo.
  // Por ahora geocodificamos solo desarrollos. Unidades: skip (heredan).
  return [];
}

async function processTarget(
  ctx: DryRunContext,
  logger: RobotLogger,
  table: "desarrollos",
  t: GeoTarget
): Promise<"hit" | "miss" | "error"> {
  const query = buildQuery(t);
  if (!query.trim()) return "miss";

  try {
    const geo = await geocode(query);
    if (!geo) {
      logger.info(`no result for "${query}"`);
      return "miss";
    }

    await execWrite(
      ctx,
      `geo ${table} ${t.id.slice(0, 8)} -> ${geo.lat},${geo.lon}`,
      `UPDATE real_estate_hub."Propyte_${table}"
       SET latitud = $1, longitud = $2, updated_at = now()
       WHERE id = $3::uuid`,
      [geo.lat, geo.lon, t.id]
    );
    logger.info(`hit: "${query}" -> ${geo.lat.toFixed(4)},${geo.lon.toFixed(4)}`);
    return "hit";
  } catch (err) {
    logger.error(`geocode failed for "${query}"`, err);
    return "error";
  }
}

async function main() {
  const opts = parseCli();
  const logger = new RobotLogger("04-geo");
  const ctx: DryRunContext = { dryRun: opts.dryRun, logger };

  const run = await logger.start({ dry_run: opts.dryRun, limit: opts.limit });

  try {
    logger.info("fetching desarrollos sin geo");
    const targets = await fetchTargets("desarrollos", opts.limit);
    logger.setMetric("targets_total", targets.length);
    logger.info(`found ${targets.length} desarrollos sin lat/lng`);

    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      const result = await processTarget(ctx, logger, "desarrollos", t);
      logger.metric(`geo_${result}`, 1);

      // Rate limit: 1 req/seg strict (Nominatim policy)
      if (i < targets.length - 1 && !opts.dryRun) {
        await sleep(RATE_LIMIT_MS);
      }
    }

    const errorCount = logger.getErrors().length;
    const status = errorCount === 0 ? (opts.dryRun ? "dry_run" : "success") : "partial";
    await logger.finish(run.id, status);

    console.log("\n## SUMMARY\n");
    console.log(JSON.stringify(logger.getMetrics(), null, 2));
  } catch (err) {
    logger.error("fatal", err);
    await logger.finish(run.id, "failure");
    throw err;
  } finally {
    await closeDb();
  }
}

main().catch((err) => {
  console.error("[FATAL]", err);
  process.exit(1);
});
