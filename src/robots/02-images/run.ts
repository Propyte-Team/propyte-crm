/**
 * Robot 02 - Image Sync
 *
 * Flujo:
 *  1. Query batch: para cada Propyte_unidades con ext_legacy_property_id, trae
 *     todas las URLs de public.property_images ordenadas por position.
 *     SOLO properties con status='published' (las imagenes son SENSITIVE —
 *     pueden tener watermarks/logos de rivales en draft/review).
 *  2. UPDATE Propyte_unidades: fotos_unidad[] + foto_portada_unidad.
 *  3. Para cada desarrollo con unidades actualizadas, agregar dedup union de
 *     URLs → Propyte_desarrollos.fotos_desarrollo[].
 *
 * Idempotente: sobreescribe arrays completos (derivados del source).
 *
 * Uso:
 *   npx tsx src/robots/02-images/run.ts --dry-run --limit 5
 *   npx tsx src/robots/02-images/run.ts
 */

import { closeDb, getDb } from "../shared/db";
import { parseCli } from "../shared/cli";
import { RobotLogger } from "../shared/logger";
import { execWrite, type DryRunContext } from "../shared/dry-run";

interface UnidadImages {
  unidad_id: string;
  id_desarrollo: string | null;
  property_id: string;
  urls: string[];
}

async function fetchImagesBatch(limit: number | null): Promise<UnidadImages[]> {
  const db = getDb();
  const limitClause = limit ? `LIMIT ${limit}` : "";

  // Una sola query batch que JOINs:
  //   Propyte_unidades (destino) <- public.properties (parent) <- property_images
  // Filtra por status='published' del parent (SENSITIVE).
  // COALESCE prefiere clean_url (sin watermark) sobre raw_url.
  const rows = (await db.$queryRawUnsafe<UnidadImages[]>(
    `SELECT u.id::text as unidad_id,
            u.id_desarrollo::text as id_desarrollo,
            u.ext_legacy_property_id::text as property_id,
            array_agg(COALESCE(i.clean_url, i.raw_url) ORDER BY i.position) as urls
     FROM real_estate_hub."Propyte_unidades" u
     JOIN public.properties p ON p.id = u.ext_legacy_property_id
     JOIN public.property_images i ON i.property_id = p.id
     WHERE u.ext_legacy_property_id IS NOT NULL
       AND u.deleted_at IS NULL
       AND p.status = 'published'
       AND COALESCE(i.clean_url, i.raw_url) IS NOT NULL
     GROUP BY u.id, u.id_desarrollo, u.ext_legacy_property_id
     ${limitClause}`
  )) as UnidadImages[];

  return rows;
}

async function updateUnidadImages(ctx: DryRunContext, item: UnidadImages): Promise<boolean> {
  if (item.urls.length === 0) return false;

  // Dedup URLs manteniendo orden
  const seen = new Set<string>();
  const dedupedUrls = item.urls.filter((u) => {
    if (!u || seen.has(u)) return false;
    seen.add(u);
    return true;
  });

  if (dedupedUrls.length === 0) return false;

  const rc = await execWrite(
    ctx,
    `update unidad ${item.unidad_id.slice(0, 8)} fotos (${dedupedUrls.length})`,
    `UPDATE real_estate_hub."Propyte_unidades"
     SET fotos_unidad = $1::text[],
         foto_portada_unidad = $2,
         updated_at = now()
     WHERE id = $3::uuid`,
    [dedupedUrls, dedupedUrls[0], item.unidad_id]
  );
  return rc !== null;
}

async function updateDesarrolloImages(
  ctx: DryRunContext,
  idDesarrollo: string,
  urlsUnion: string[]
): Promise<void> {
  const seen = new Set<string>();
  const deduped = urlsUnion.filter((u) => {
    if (!u || seen.has(u)) return false;
    seen.add(u);
    return true;
  });

  if (deduped.length === 0) return;

  await execWrite(
    ctx,
    `update desarrollo ${idDesarrollo.slice(0, 8)} fotos (${deduped.length})`,
    `UPDATE real_estate_hub."Propyte_desarrollos"
     SET fotos_desarrollo = $1::text[],
         updated_at = now()
     WHERE id = $2::uuid`,
    [deduped, idDesarrollo]
  );
}

async function main() {
  const opts = parseCli();
  const logger = new RobotLogger("02-images");
  const ctx: DryRunContext = { dryRun: opts.dryRun, logger };

  const run = await logger.start({ dry_run: opts.dryRun, limit: opts.limit });

  try {
    logger.info("fetching image batch");
    const items = await fetchImagesBatch(opts.limit);
    logger.setMetric("unidades_with_images", items.length);
    logger.setMetric(
      "total_images",
      items.reduce((s, i) => s + i.urls.length, 0)
    );
    logger.info(`got ${items.length} unidades with images`);

    // Actualizar unidades
    const desarrolloUrls = new Map<string, Set<string>>();
    for (const item of items) {
      try {
        const updated = await updateUnidadImages(ctx, item);
        if (updated) logger.metric("unidades_updated", 1);

        // Acumular URLs por desarrollo
        if (item.id_desarrollo) {
          if (!desarrolloUrls.has(item.id_desarrollo)) {
            desarrolloUrls.set(item.id_desarrollo, new Set());
          }
          const set = desarrolloUrls.get(item.id_desarrollo)!;
          for (const url of item.urls) if (url) set.add(url);
        }
      } catch (err) {
        logger.error(`unidad ${item.unidad_id.slice(0, 8)} failed`, err);
        logger.metric("unidades_failed", 1);
      }
    }

    // Actualizar desarrollos (union de todas las unidades del desarrollo)
    logger.info(`updating ${desarrolloUrls.size} desarrollos con union de fotos`);
    for (const [idDesarrollo, urlSet] of desarrolloUrls) {
      try {
        await updateDesarrolloImages(ctx, idDesarrollo, Array.from(urlSet));
        logger.metric("desarrollos_updated", 1);
      } catch (err) {
        logger.error(`desarrollo ${idDesarrollo.slice(0, 8)} failed`, err);
        logger.metric("desarrollos_failed", 1);
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
