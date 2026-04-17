/**
 * Verifica que el contenido fluye correctamente a través de las vistas actualizadas.
 * Consulta v_developments y v_units con los nuevos campos de contenido.
 *
 * npx tsx scripts/verify-content-flow.ts
 */

import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";

config();

const NEW_REF = "oaijxdpevakashxshhvm";
const PASSWORD = process.env.SUPABASE_DB_PASSWORD;

if (!PASSWORD) {
  console.error("[FATAL] SUPABASE_DB_PASSWORD no esta definido en .env");
  process.exit(1);
}

const URL = `postgresql://postgres.${NEW_REF}:${encodeURIComponent(
  PASSWORD
)}@aws-1-us-east-1.pooler.supabase.com:5432/postgres`;

async function main() {
  const db = new PrismaClient({ datasources: { db: { url: URL } } });

  try {
    console.log("============================================");
    console.log("VERIFY CONTENT FLOW — v_developments + v_units");
    console.log("============================================\n");

    // 1. Count developments with content
    const devStats = (await db.$queryRawUnsafe(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(description_es)::int AS with_description_es,
        COUNT(publication_title)::int AS with_pub_title,
        COUNT(meta_title)::int AS with_meta_title,
        COUNT(meta_description)::int AS with_meta_desc,
        COUNT(content_features_es)::int AS with_features,
        COUNT(content_location_es)::int AS with_location,
        COUNT(content_lifestyle_es)::int AS with_lifestyle,
        COUNT(faq_es)::int AS with_faq,
        COUNT(content_es)::int AS with_content_jsonb,
        COUNT(CASE WHEN amenities != '{}' THEN 1 END)::int AS with_amenities
      FROM real_estate_hub.v_developments
      WHERE deleted_at IS NULL
    `)) as any[];

    console.log("## v_developments — Content Coverage\n");
    const ds = devStats[0];
    console.log(`  Total desarrollos:      ${ds.total}`);
    console.log(`  Con description_es:     ${ds.with_description_es} (${pct(ds.with_description_es, ds.total)})`);
    console.log(`  Con publication_title:  ${ds.with_pub_title} (${pct(ds.with_pub_title, ds.total)})`);
    console.log(`  Con meta_title:         ${ds.with_meta_title} (${pct(ds.with_meta_title, ds.total)})`);
    console.log(`  Con meta_description:   ${ds.with_meta_desc} (${pct(ds.with_meta_desc, ds.total)})`);
    console.log(`  Con features_es:        ${ds.with_features} (${pct(ds.with_features, ds.total)})`);
    console.log(`  Con location_es:        ${ds.with_location} (${pct(ds.with_location, ds.total)})`);
    console.log(`  Con lifestyle_es:       ${ds.with_lifestyle} (${pct(ds.with_lifestyle, ds.total)})`);
    console.log(`  Con FAQ:                ${ds.with_faq} (${pct(ds.with_faq, ds.total)})`);
    console.log(`  Con content JSONB raw:  ${ds.with_content_jsonb} (${pct(ds.with_content_jsonb, ds.total)})`);
    console.log(`  Con amenidades:         ${ds.with_amenities} (${pct(ds.with_amenities, ds.total)})`);

    // 2. Sample a development with content
    const sampleDev = (await db.$queryRawUnsafe(`
      SELECT name, publication_title, description_es, meta_title, meta_description,
             content_features_es, content_location_es, amenities, city, state
      FROM real_estate_hub.v_developments
      WHERE content_es IS NOT NULL AND deleted_at IS NULL
      ORDER BY updated_at DESC
      LIMIT 3
    `)) as any[];

    console.log("\n## Sample Developments (with content)\n");
    for (const d of sampleDev) {
      console.log(`  --- ${d.name} (${d.city}, ${d.state}) ---`);
      console.log(`    pub_title:     ${(d.publication_title || 'NULL').slice(0, 80)}`);
      console.log(`    description:   ${(d.description_es || 'NULL').slice(0, 120)}...`);
      console.log(`    meta_title:    ${(d.meta_title || 'NULL').slice(0, 80)}`);
      console.log(`    meta_desc:     ${(d.meta_description || 'NULL').slice(0, 100)}`);
      console.log(`    features:      ${(d.content_features_es || 'NULL').slice(0, 80)}`);
      console.log(`    location:      ${(d.content_location_es || 'NULL').slice(0, 80)}`);
      console.log(`    amenities:     ${JSON.stringify(d.amenities)?.slice(0, 80)}`);
      console.log();
    }

    // 3. Count units with content
    const unitStats = (await db.$queryRawUnsafe(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(description_es)::int AS with_description_es,
        COUNT(title)::int AS with_title,
        COUNT(meta_title)::int AS with_meta_title,
        COUNT(content_es)::int AS with_content_jsonb
      FROM real_estate_hub.v_units
      WHERE deleted_at IS NULL
    `)) as any[];

    console.log("## v_units — Content Coverage\n");
    const us = unitStats[0];
    console.log(`  Total unidades:         ${us.total}`);
    console.log(`  Con description_es:     ${us.with_description_es} (${pct(us.with_description_es, us.total)})`);
    console.log(`  Con title:              ${us.with_title} (${pct(us.with_title, us.total)})`);
    console.log(`  Con meta_title:         ${us.with_meta_title} (${pct(us.with_meta_title, us.total)})`);
    console.log(`  Con content JSONB raw:  ${us.with_content_jsonb} (${pct(us.with_content_jsonb, us.total)})`);

    // 4. Sample units with content
    const sampleUnit = (await db.$queryRawUnsafe(`
      SELECT title, description_es, meta_title, description_short,
             development_name, city
      FROM real_estate_hub.v_units
      WHERE content_es IS NOT NULL AND deleted_at IS NULL
      ORDER BY updated_at DESC
      LIMIT 3
    `)) as any[];

    console.log("\n## Sample Units (with content)\n");
    for (const u of sampleUnit) {
      console.log(`  --- ${u.development_name || 'sin desarrollo'} (${u.city}) ---`);
      console.log(`    title:         ${(u.title || 'NULL').slice(0, 80)}`);
      console.log(`    description:   ${(u.description_es || 'NULL').slice(0, 120)}...`);
      console.log(`    meta_title:    ${(u.meta_title || 'NULL').slice(0, 80)}`);
      console.log(`    desc_short:    ${(u.description_short || 'NULL').slice(0, 80)}`);
      console.log();
    }

    // 5. Check approved records that would pass to WP
    const approvedDevs = (await db.$queryRawUnsafe(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(description_es)::int AS with_desc,
        COUNT(publication_title)::int AS with_pub_title,
        COUNT(CASE WHEN amenities != '{}' THEN 1 END)::int AS with_amenities
      FROM real_estate_hub.v_developments
      WHERE deleted_at IS NULL
        AND approved_at IS NOT NULL
        AND zoho_pipeline_status IN ('aprobado', 'Aprobado', 'listo', 'Listo')
    `)) as any[];

    console.log("## Approved Developments (would sync to WP)\n");
    const ad = approvedDevs[0];
    console.log(`  Aprobados:              ${ad.total}`);
    console.log(`  Con description_es:     ${ad.with_desc} (${pct(ad.with_desc, ad.total)})`);
    console.log(`  Con publication_title:  ${ad.with_pub_title} (${pct(ad.with_pub_title, ad.total)})`);
    console.log(`  Con amenidades:         ${ad.with_amenities} (${pct(ad.with_amenities, ad.total)})`);

    console.log("\n============================================");
    console.log("OK — Verification complete");
    console.log("============================================\n");

  } finally {
    await db.$disconnect();
  }
}

function pct(n: number, total: number): string {
  if (total === 0) return "0%";
  return Math.round((n / total) * 100) + "%";
}

main().catch((err) => {
  console.error("\n[FATAL]", err);
  process.exit(1);
});
