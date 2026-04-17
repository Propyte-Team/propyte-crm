/**
 * Inspecciona 3 properties con status='published' de public.properties:
 *  - Schema completo de public.properties (information_schema)
 *  - Schema de public.property_images
 *  - raw_data completo (pretty JSON)
 *  - extracted_data completo
 *
 * Objetivo: validar que campos del screenshot (FAQ, Caracteristicas, Ubicacion)
 * vienen del scraper o se generan en el frontend.
 */
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
config();

const NEW_URL = `postgresql://postgres.oaijxdpevakashxshhvm:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD!)}@aws-1-us-east-1.pooler.supabase.com:5432/postgres`;

async function main() {
  const db = new PrismaClient({ datasources: { db: { url: NEW_URL } } });
  try {
    console.log("\n============================================");
    console.log("INSPECCION DE PROPERTIES PUBLISHED");
    console.log("============================================\n");

    // 1. Schema completo de public.properties
    console.log("## 1. Columnas de public.properties\n");
    const cols = (await db.$queryRawUnsafe(
      `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'properties'
       ORDER BY ordinal_position`
    )) as any[];
    for (const c of cols) console.log(`  ${c.column_name}: ${c.data_type}${c.is_nullable === 'YES' ? ' NULL' : ''}`);

    // 2. Schema de public.property_images
    console.log("\n## 2. Columnas de public.property_images\n");
    const imgCols = (await db.$queryRawUnsafe(
      `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'property_images'
       ORDER BY ordinal_position`
    )) as any[];
    for (const c of imgCols) console.log(`  ${c.column_name}: ${c.data_type}${c.is_nullable === 'YES' ? ' NULL' : ''}`);

    // 3. Sample de 3 published
    console.log("\n## 3. Sample de 3 properties con status='published'\n");
    const samples = (await db.$queryRawUnsafe(
      `SELECT id::text, title, price_cents, currency, bedrooms, bathrooms,
              construction_m2, development_name, developer_name,
              state, city, status,
              raw_data, extracted_data, content_es, content_en, content_fr,
              content_hash, last_seen_at, first_seen_at, published_at, source_url,
              (SELECT COUNT(*) FROM public.property_images pi WHERE pi.property_id = p.id)::int as image_count
       FROM public.properties p
       WHERE status = 'published'
       ORDER BY published_at DESC NULLS LAST
       LIMIT 3`
    )) as any[];

    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      console.log(`\n=== PUBLISHED #${i + 1} ===`);
      console.log(`  id: ${s.id}`);
      console.log(`  title: ${s.title}`);
      console.log(`  price: ${s.price_cents} ${s.currency} (= ${Number(s.price_cents) / 100} ${s.currency})`);
      console.log(`  ${s.bedrooms}br / ${s.bathrooms}ba / ${s.construction_m2}m2`);
      console.log(`  developer: ${s.developer_name} / development: ${s.development_name}`);
      console.log(`  location: ${s.state} / ${s.city}`);
      console.log(`  images: ${s.image_count}`);
      console.log(`  first_seen: ${s.first_seen_at}`);
      console.log(`  last_seen: ${s.last_seen_at}`);
      console.log(`  published_at: ${s.published_at}`);
      console.log(`  source_url: ${s.source_url}`);
      console.log(`  content_hash: ${s.content_hash?.slice(0, 16)}...`);
      console.log(`\n  raw_data keys: ${Object.keys(s.raw_data || {}).join(', ')}`);
      console.log(`  extracted_data keys: ${Object.keys(s.extracted_data || {}).join(', ')}`);
      console.log(`\n  content_es keys: ${Object.keys(s.content_es || {}).join(', ')}`);
      console.log(`  content_en keys: ${Object.keys(s.content_en || {}).join(', ')}`);
      console.log(`  content_fr keys: ${Object.keys(s.content_fr || {}).join(', ')}`);

      // Contenido parafraseado (seguramente en content_es)
      if (s.content_es) {
        const snippet = JSON.stringify(s.content_es, null, 2).slice(0, 800);
        console.log(`\n  content_es (first 800 chars):\n${snippet}`);
      }
      // Descripcion cruda
      if (s.raw_data?.description) {
        const desc = String(s.raw_data.description);
        console.log(`\n  raw_data.description (${desc.length} chars): "${desc.slice(0, 200)}..."`);
      }
      // Amenities
      if (s.raw_data?.amenities) {
        console.log(`\n  raw_data.amenities: ${JSON.stringify(s.raw_data.amenities).slice(0, 300)}`);
      }
    }

    // 4. Sample imagen de una published
    console.log("\n## 4. Sample de 3 property_images de una published\n");
    if (samples.length > 0) {
      const imgs = (await db.$queryRawUnsafe(
        `SELECT id::text, property_id::text, position, raw_url, clean_url, created_at
         FROM public.property_images
         WHERE property_id = '${samples[0].id}'::uuid
         ORDER BY position LIMIT 3`
      )) as any[];
      for (const img of imgs) {
        console.log(`  position ${img.position}:`);
        console.log(`    raw_url:   ${img.raw_url?.slice(0, 100)}`);
        console.log(`    clean_url: ${img.clean_url?.slice(0, 100) ?? '(null)'}`);
      }
    }

    // 5. Columnas de public.property_changes
    console.log("\n## 5. Columnas de public.property_changes\n");
    const changeCols = (await db.$queryRawUnsafe(
      `SELECT column_name, data_type
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'property_changes'
       ORDER BY ordinal_position`
    )) as any[];
    for (const c of changeCols) console.log(`  ${c.column_name}: ${c.data_type}`);

    // 6. Otras tablas en public
    console.log("\n## 6. Todas las tablas en schema public\n");
    const tables = (await db.$queryRawUnsafe(
      `SELECT table_name, (SELECT COUNT(*)::int FROM information_schema.columns
         WHERE table_schema='public' AND table_name=t.table_name) as cols
       FROM information_schema.tables t
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       ORDER BY table_name`
    )) as any[];
    for (const t of tables) console.log(`  ${t.table_name} (${t.cols} cols)`);

    console.log("\n============================================\n");
  } finally {
    await db.$disconnect();
  }
}
main();
