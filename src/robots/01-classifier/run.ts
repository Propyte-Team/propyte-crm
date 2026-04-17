/**
 * Robot 01 - Classifier + Extractor
 * Entry point CLI.
 *
 * Flujo:
 *  1. Fetch properties admisibles agrupadas por development_name
 *  2. Para cada grupo:
 *     a. Resolver/insertar desarrollador (pg_trgm)
 *     b. Extraer payload desarrollo + payloads unidades
 *     c. Upsert desarrollo (ON CONFLICT (lower(nombre), id_desarrollador))
 *     d. Upsert unidades (ON CONFLICT (ext_source_url))
 *  3. Log metrics a Propyte_robot_runs
 *
 * Dry-run: todo lo anterior excepto los UPSERTs finales.
 *
 * Uso:
 *   npx tsx src/robots/01-classifier/run.ts --dry-run --limit 10
 *   npx tsx src/robots/01-classifier/run.ts --source goodlers.com
 *   npx tsx src/robots/01-classifier/run.ts
 */

import { closeDb } from "../shared/db";
import { parseCli } from "../shared/cli";
import { RobotLogger } from "../shared/logger";
import { upsertReturningId, execWrite, type DryRunContext } from "../shared/dry-run";
import { fetchAndGroup, NO_DEV_KEY } from "./classifier";
import { extractGroup } from "./extractor";
import { __resetDevCache } from "./dedup-developers";
import type {
  PropyteDesarrolloWrite,
  PropyteUnidadWrite,
} from "../shared/types";

/**
 * Columnas jsonb en real_estate_hub.Propyte_desarrollos y Propyte_unidades.
 * Necesitan cast explicito $N::jsonb porque Prisma usa prepared statements que
 * no hacen text->jsonb automatico.
 */
const JSONB_COLUMNS = new Set([
  "ext_content_es",
  "ext_content_en",
  "ext_content_fr",
  "ext_content_hashes",
  "amenidades_adicionales",
  "puntos_interes",
  "redes_sociales",
]);

const ARRAY_COLUMNS = new Set([
  "ext_keywords",
  "ext_meses_financiamiento",
  "ext_property_types",
  "ext_usage",
  "ext_tags",
  "ext_docs_legales",
  "fotos_unidad",
  "fotos_desarrollo",
  "renders_3d_unidad",
]);

const UUID_COLUMNS = new Set([
  "id",
  "id_desarrollo",
  "id_desarrollador",
  "id_unidad",
  "approved_by",
  "ext_reserved_by_contact_id",
  "lead_owner_id",
  "zoho_record_id_ref",
  "ext_legacy_property_id",
]);

interface BuiltInsert {
  sql: string;
  values: unknown[];
}

/**
 * Genera SQL de INSERT/UPSERT con casts correctos por columna.
 */
function buildUpsert<T extends Record<string, unknown>>(
  table: string,
  payload: T,
  conflictClause: string,
  returning?: string
): BuiltInsert {
  const cols = Object.keys(payload).filter((k) => payload[k] !== undefined) as Array<keyof T & string>;
  const quotedCols = cols.map((c) => `"${c}"`);
  const placeholders: string[] = [];
  const values: unknown[] = [];

  for (let i = 0; i < cols.length; i++) {
    const c = cols[i];
    const raw = payload[c];
    const isJsonb = JSONB_COLUMNS.has(c);
    const isArray = ARRAY_COLUMNS.has(c);
    const isUuid = UUID_COLUMNS.has(c);

    const { value, cast } = prepareValue(raw, { isJsonb, isArray, isUuid });
    values.push(value);
    placeholders.push(`$${i + 1}${cast}`);
  }

  const updateSet = cols
    .filter((c) => c !== "id")
    .map((c) => `"${c}" = EXCLUDED."${c}"`)
    .join(", ");

  const sql = `
    INSERT INTO ${table} (${quotedCols.join(", ")})
    VALUES (${placeholders.join(", ")})
    ${conflictClause}
    DO UPDATE SET ${updateSet}, updated_at = now()
    ${returning ? `RETURNING ${returning}` : ""}
  `.trim();

  return { sql, values };
}

function prepareValue(
  v: unknown,
  opts: { isJsonb: boolean; isArray: boolean; isUuid: boolean }
): { value: unknown; cast: string } {
  if (v == null) {
    return {
      value: null,
      cast: opts.isJsonb ? "::jsonb" : opts.isArray ? "::text[]" : opts.isUuid ? "::uuid" : "",
    };
  }
  if (v instanceof Date) return { value: v.toISOString(), cast: "::timestamptz" };
  if (typeof v === "bigint") return { value: Number(v), cast: "" };

  if (typeof v === "object") {
    // Prisma Decimal
    const asAny = v as { toNumber?: () => number; d?: number[] };
    if (typeof asAny.toNumber === "function" && Array.isArray(asAny.d)) {
      return { value: asAny.toNumber(), cast: "" };
    }

    if (Array.isArray(v)) {
      if (opts.isJsonb) return { value: JSON.stringify(v), cast: "::jsonb" };
      // Postgres text[] acepta array JS directamente (Prisma lo serializa bien)
      return { value: v, cast: opts.isArray ? "::text[]" : "" };
    }

    // Objeto plano → jsonb
    return { value: JSON.stringify(v), cast: "::jsonb" };
  }

  if (typeof v === "string") {
    if (opts.isJsonb) return { value: v, cast: "::jsonb" }; // pre-stringified
    if (opts.isUuid) return { value: v, cast: "::uuid" };
  }

  return { value: v, cast: "" };
}

async function upsertDesarrollo(
  ctx: DryRunContext,
  payload: PropyteDesarrolloWrite
): Promise<string> {
  const { sql, values } = buildUpsert(
    `real_estate_hub."Propyte_desarrollos"`,
    payload as unknown as Record<string, unknown>,
    // Target debe coincidir EXACTAMENTE con idx_desarrollos_nombre_desarrollador
    // (ver scripts/sql/robot_infra_0002.sql)
    `ON CONFLICT (lower(nombre_desarrollo), COALESCE(id_desarrollador::text, 'NULL')) WHERE deleted_at IS NULL`,
    `id::text`
  );

  return upsertReturningId(
    ctx,
    `upsert desarrollo "${payload.nombre_desarrollo}"`,
    sql,
    values,
    `desarrollo:${payload.nombre_desarrollo.toLowerCase()}:${payload.id_desarrollador ?? "no-dev"}`
  );
}

async function upsertUnidad(ctx: DryRunContext, payload: PropyteUnidadWrite): Promise<void> {
  if (!payload.ext_legacy_property_id) {
    throw new Error(
      "upsertUnidad: ext_legacy_property_id requerido (clave canonica de idempotencia)"
    );
  }

  // Usa idx_unidades_legacy_property_id (partial unique WHERE legacy_property_id IS NOT NULL)
  const { sql, values } = buildUpsert(
    `real_estate_hub."Propyte_unidades"`,
    payload as unknown as Record<string, unknown>,
    `ON CONFLICT (ext_legacy_property_id) WHERE ext_legacy_property_id IS NOT NULL AND deleted_at IS NULL`
  );

  await execWrite(
    ctx,
    `upsert unidad property_id=${payload.ext_legacy_property_id.slice(0, 8)}...`,
    sql,
    values
  );
}

/**
 * Serializa un valor JS para $executeRawUnsafe / $queryRawUnsafe.
 * - Date → ISO string (Postgres lo acepta como timestamptz)
 * - objects/arrays → JSON string (Postgres lo acepta como jsonb via cast implicito... NO)
 *
 * Para jsonb necesitamos JSON string Y cast en el SQL. Para evitar complejidad
 * del SQL generador, hacemos JSON.stringify aqui y asumimos que la columna
 * es jsonb (Postgres hace el cast automatico desde text en INSERT).
 *
 * NOTA: Postgres NO hace cast text→jsonb automatico. Usamos $N::jsonb en el SQL.
 * Por ahora: pasamos el string y confiamos en que las columnas jsonb acepten text
 * via cast explicito. Si falla, mejoramos el generador.
 */
function serializeValue(v: unknown): unknown {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "bigint") return Number(v);

  // Prisma Decimal (numeric columns): tiene .toNumber() y .toFixed()
  // Detectable por el method toNumber que no existe en objetos planos
  if (typeof v === "object") {
    const asAny = v as { toNumber?: () => number; s?: number; e?: number; d?: number[] };
    if (typeof asAny.toNumber === "function" && Array.isArray(asAny.d)) {
      return asAny.toNumber();
    }
    // Array JS plano (ej text[] de Postgres) pasa directo
    if (Array.isArray(v)) return v;
    // jsonb objetos: JSON.stringify
    return JSON.stringify(v);
  }

  return v;
}

async function main() {
  const opts = parseCli();
  const logger = new RobotLogger("01-classifier");
  const ctx: DryRunContext = { dryRun: opts.dryRun, logger };

  __resetDevCache(); // fresh cache per run

  const run = await logger.start({
    dry_run: opts.dryRun,
    limit: opts.limit,
    source: opts.source,
    development: opts.development,
  });

  try {
    logger.info("fetching and grouping properties");
    const groups = await fetchAndGroup({
      limit: opts.limit,
      sourceDomain: opts.source,
      developmentName: opts.development,
    });
    logger.setMetric("groups_total", groups.length);
    logger.setMetric(
      "properties_total",
      groups.reduce((s, g) => s + g.properties.length, 0)
    );
    logger.setMetric(
      "groups_no_dev",
      groups.filter((g) => g.key === NO_DEV_KEY).length
    );
    logger.info(`fetched ${groups.length} groups, ${logger.getMetrics().properties_total} properties`);

    // Separar grupo __NO_DEV__ al final (menos critico)
    const realGroups = groups.filter((g) => g.key !== NO_DEV_KEY);
    const noDevGroup = groups.find((g) => g.key === NO_DEV_KEY);

    for (const group of realGroups) {
      try {
        logger.info(`processing group "${group.displayName}" (${group.properties.length} props)`);
        const extracted = await extractGroup(ctx, group);

        if (extracted.stats.developerMethod === "inserted") {
          logger.metric("desarrolladores_created", 1);
        } else if (extracted.stats.developerMethod) {
          logger.metric("desarrolladores_reused", 1);
        }

        let idDesarrollo: string | null = null;
        if (extracted.desarrollo) {
          idDesarrollo = await upsertDesarrollo(ctx, extracted.desarrollo);
          logger.metric("desarrollos_upserted", 1);
        }

        for (const unidad of extracted.unidades) {
          unidad.id_desarrollo = idDesarrollo;
          await upsertUnidad(ctx, unidad);
          logger.metric("unidades_upserted", 1);
        }

        logger.metric("amenities_matched", extracted.stats.amenitiesMatched);
        logger.metric("amenities_unmatched", extracted.stats.amenitiesUnmatched);
        logger.metric("properties_published", extracted.stats.publishedCount);
        logger.metric("properties_review", extracted.stats.reviewCount);
      } catch (err) {
        logger.error(`group "${group.displayName}" failed`, err, { group_key: group.key });
        logger.metric("groups_failed", 1);
      }
    }

    // Procesa __NO_DEV__ (properties sueltas sin desarrollo)
    if (noDevGroup) {
      logger.info(`processing ${noDevGroup.properties.length} properties sin development_name`);
      try {
        const extracted = await extractGroup(ctx, noDevGroup);
        for (const unidad of extracted.unidades) {
          await upsertUnidad(ctx, unidad);
          logger.metric("unidades_sueltas_upserted", 1);
        }
      } catch (err) {
        logger.error("__NO_DEV__ group failed", err);
      }
    }

    const errorCount = logger.getErrors().length;
    const status = errorCount === 0 ? (opts.dryRun ? "dry_run" : "success") : "partial";
    await logger.finish(run.id, status);

    console.log("\n## SUMMARY\n");
    console.log(JSON.stringify(logger.getMetrics(), null, 2));
    if (errorCount > 0) console.log(`\n[WARN] ${errorCount} errores. Ver Propyte_robot_runs.errors`);
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
