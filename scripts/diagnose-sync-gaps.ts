/**
 * Diagnostica por qué el sync de WP solo trae 26 desarrollos y 0 unidades.
 * Analiza cada paso del filtro que aplica WordPress.
 *
 * npx tsx scripts/diagnose-sync-gaps.ts
 */

import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";

config();

const NEW_REF = "oaijxdpevakashxshhvm";
const PASSWORD = process.env.SUPABASE_DB_PASSWORD;
const URL = `postgresql://postgres.${NEW_REF}:${encodeURIComponent(
  PASSWORD!
)}@aws-1-us-east-1.pooler.supabase.com:5432/postgres`;

async function main() {
  const db = new PrismaClient({ datasources: { db: { url: URL } } });

  try {
    console.log("============================================");
    console.log("DIAGNÓSTICO: Por qué WP solo trae 26 desarrollos y 0 unidades");
    console.log("============================================\n");

    // ── DESARROLLOS ──────────────────────────────────────────

    console.log("## DESARROLLOS — Funnel de filtros\n");

    const totalDevs = await q(db, `SELECT COUNT(*)::int as n FROM real_estate_hub.v_developments WHERE deleted_at IS NULL`);
    console.log(`  1. Total en vista:                     ${totalDevs[0].n}`);

    const published = await q(db, `SELECT COUNT(*)::int as n FROM real_estate_hub.v_developments WHERE deleted_at IS NULL AND published = true`);
    console.log(`  2. Con published=true:                 ${published[0].n}`);

    const withCity = await q(db, `SELECT COUNT(*)::int as n FROM real_estate_hub.v_developments WHERE deleted_at IS NULL AND published = true AND city IS NOT NULL`);
    console.log(`  3. + city NOT NULL:                    ${withCity[0].n}`);

    const withApproval = await q(db, `SELECT COUNT(*)::int as n FROM real_estate_hub.v_developments WHERE deleted_at IS NULL AND published = true AND city IS NOT NULL AND approved_at IS NOT NULL`);
    console.log(`  4. + approved_at NOT NULL:              ${withApproval[0].n}`);

    const withStatus = await q(db, `SELECT COUNT(*)::int as n FROM real_estate_hub.v_developments WHERE deleted_at IS NULL AND published = true AND city IS NOT NULL AND approved_at IS NOT NULL AND LOWER(zoho_pipeline_status) IN ('aprobado','listo')`);
    console.log(`  5. + pipeline_status aprobado/listo:   ${withStatus[0].n}`);

    const withName = await q(db, `SELECT COUNT(*)::int as n FROM real_estate_hub.v_developments WHERE deleted_at IS NULL AND published = true AND city IS NOT NULL AND approved_at IS NOT NULL AND LOWER(zoho_pipeline_status) IN ('aprobado','listo') AND name IS NOT NULL AND name != ''`);
    console.log(`  6. + name NOT empty:                   ${withName[0].n}`);

    // Quality check: at least 1 non-Unsplash image
    const withImages = await q(db, `
      SELECT COUNT(*)::int as n
      FROM real_estate_hub.v_developments
      WHERE deleted_at IS NULL
        AND published = true AND city IS NOT NULL
        AND approved_at IS NOT NULL
        AND LOWER(zoho_pipeline_status) IN ('aprobado','listo')
        AND name IS NOT NULL AND name != ''
        AND images IS NOT NULL
        AND ARRAY_LENGTH(images, 1) > 0
    `);
    console.log(`  7. + tiene al menos 1 imagen:          ${withImages[0].n}`);

    // Check how many have real (non-unsplash) images
    const withRealImages = await q(db, `
      SELECT COUNT(*)::int as n
      FROM real_estate_hub.v_developments d
      WHERE d.deleted_at IS NULL
        AND d.published = true AND d.city IS NOT NULL
        AND d.approved_at IS NOT NULL
        AND LOWER(d.zoho_pipeline_status) IN ('aprobado','listo')
        AND d.name IS NOT NULL AND d.name != ''
        AND EXISTS (
          SELECT 1 FROM UNNEST(d.images) AS img
          WHERE img IS NOT NULL AND img != '' AND img NOT LIKE '%unsplash.com%'
        )
    `);
    console.log(`  8. + imagen real (no Unsplash):        ${withRealImages[0].n}  ← ESTO ES LO QUE WP TRAE`);

    // Show what's being filtered out at each step
    const noImages = await q(db, `
      SELECT name, city, images
      FROM real_estate_hub.v_developments
      WHERE deleted_at IS NULL
        AND published = true AND city IS NOT NULL
        AND approved_at IS NOT NULL
        AND LOWER(zoho_pipeline_status) IN ('aprobado','listo')
        AND name IS NOT NULL AND name != ''
        AND (images IS NULL OR ARRAY_LENGTH(images, 1) IS NULL OR ARRAY_LENGTH(images, 1) = 0)
      ORDER BY name
      LIMIT 10
    `);
    console.log(`\n  Muestra de aprobados SIN imágenes (rechazados):`);
    for (const d of noImages) {
      console.log(`    - ${d.name} (${d.city}) — images: ${d.images ? JSON.stringify(d.images).slice(0, 50) : 'NULL'}`);
    }

    // ── UNIDADES ──────────────────────────────────────────

    console.log("\n\n## UNIDADES — Funnel de filtros\n");

    const totalUnits = await q(db, `SELECT COUNT(*)::int as n FROM real_estate_hub.v_units WHERE deleted_at IS NULL`);
    console.log(`  1. Total en vista:                     ${totalUnits[0].n}`);

    const unitsApproved = await q(db, `SELECT COUNT(*)::int as n FROM real_estate_hub.v_units WHERE deleted_at IS NULL AND approved_at IS NOT NULL`);
    console.log(`  2. Con approved_at NOT NULL:            ${unitsApproved[0].n}`);

    const unitsStatus = await q(db, `SELECT COUNT(*)::int as n FROM real_estate_hub.v_units WHERE deleted_at IS NULL AND approved_at IS NOT NULL AND LOWER(zoho_pipeline_status) IN ('aprobado','listo')`);
    console.log(`  3. + pipeline_status aprobado/listo:   ${unitsStatus[0].n}`);

    const unitsWithDev = await q(db, `SELECT COUNT(*)::int as n FROM real_estate_hub.v_units WHERE deleted_at IS NULL AND approved_at IS NOT NULL AND LOWER(zoho_pipeline_status) IN ('aprobado','listo') AND development_id IS NOT NULL`);
    console.log(`  4. + tiene development_id:             ${unitsWithDev[0].n}`);

    const unitsWithPrice = await q(db, `SELECT COUNT(*)::int as n FROM real_estate_hub.v_units WHERE deleted_at IS NULL AND approved_at IS NOT NULL AND LOWER(zoho_pipeline_status) IN ('aprobado','listo') AND development_id IS NOT NULL AND (price_mxn > 0 OR price_usd > 0)`);
    console.log(`  5. + tiene precio > 0:                 ${unitsWithPrice[0].n}`);

    // Check: do the development_ids match synced developments?
    const unitsLinkedToApproved = await q(db, `
      SELECT COUNT(*)::int as n
      FROM real_estate_hub.v_units u
      WHERE u.deleted_at IS NULL
        AND u.approved_at IS NOT NULL
        AND LOWER(u.zoho_pipeline_status) IN ('aprobado','listo')
        AND u.development_id IS NOT NULL
        AND (u.price_mxn > 0 OR u.price_usd > 0)
        AND EXISTS (
          SELECT 1 FROM real_estate_hub.v_developments d
          WHERE d.id = u.development_id
            AND d.deleted_at IS NULL
            AND d.published = true AND d.city IS NOT NULL
            AND d.approved_at IS NOT NULL
            AND LOWER(d.zoho_pipeline_status) IN ('aprobado','listo')
            AND EXISTS (SELECT 1 FROM UNNEST(d.images) AS img WHERE img IS NOT NULL AND img != '' AND img NOT LIKE '%unsplash.com%')
        )
    `);
    console.log(`  6. + desarrollo padre pasó calidad:    ${unitsLinkedToApproved[0].n}  ← ESTO ES LO QUE WP TRAERÍA`);

    // Show pipeline status distribution
    console.log("\n\n## DISTRIBUCIÓN de zoho_pipeline_status\n");

    const devStatuses = await q(db, `
      SELECT COALESCE(zoho_pipeline_status, '(null)') as status, COUNT(*)::int as n
      FROM real_estate_hub."Propyte_desarrollos"
      WHERE deleted_at IS NULL AND ext_publicado = true AND approved_at IS NOT NULL
      GROUP BY zoho_pipeline_status
      ORDER BY n DESC
    `);
    console.log("  Desarrollos aprobados:");
    for (const s of devStatuses) console.log(`    ${s.status}: ${s.n}`);

    const unitStatuses = await q(db, `
      SELECT COALESCE(zoho_pipeline_status, '(null)') as status, COUNT(*)::int as n
      FROM real_estate_hub."Propyte_unidades"
      WHERE deleted_at IS NULL
      GROUP BY zoho_pipeline_status
      ORDER BY n DESC
    `);
    console.log("\n  Unidades (todas):");
    for (const s of unitStatuses) console.log(`    ${s.status}: ${s.n}`);

    // Check approved_at on units
    const unitApprovalStats = await q(db, `
      SELECT
        COUNT(*)::int as total,
        COUNT(approved_at)::int as with_approved,
        COUNT(CASE WHEN zoho_pipeline_status IS NOT NULL THEN 1 END)::int as with_status
      FROM real_estate_hub."Propyte_unidades"
      WHERE deleted_at IS NULL
    `);
    console.log("\n  Unidades — estado de aprobación:");
    console.log(`    Total: ${unitApprovalStats[0].total}`);
    console.log(`    Con approved_at: ${unitApprovalStats[0].with_approved}`);
    console.log(`    Con zoho_pipeline_status: ${unitApprovalStats[0].with_status}`);

    console.log("\n============================================");
    console.log("DIAGNÓSTICO COMPLETO");
    console.log("============================================\n");

  } finally {
    await db.$disconnect();
  }
}

async function q(db: PrismaClient, sql: string) {
  return db.$queryRawUnsafe(sql) as Promise<any[]>;
}

main().catch((err) => {
  console.error("\n[FATAL]", err);
  process.exit(1);
});
