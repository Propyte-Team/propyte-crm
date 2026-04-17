/**
 * Analiza los datos reales en public.* de Felipe para entender:
 * - Valores de property_type / listing_type (para clasificar)
 * - Distribucion de development_name
 * - Estructura de extracted_data / raw_data jsonb
 * - Sources disponibles
 * - Gaps de data vs nuestro schema real_estate_hub
 */
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
config();

const NEW_URL = `postgresql://postgres.oaijxdpevakashxshhvm:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD!)}@aws-1-us-east-1.pooler.supabase.com:5432/postgres`;

async function main() {
  const db = new PrismaClient({ datasources: { db: { url: NEW_URL } } });
  try {
    console.log("\n============================================");
    console.log("ANALISIS DE DATOS DE FELIPE (public.*)");
    console.log("============================================\n");

    // 1. Sources configuradas
    console.log("## 1. Sources (fuentes configuradas)\n");
    const sources = (await db.$queryRawUnsafe(
      `SELECT id::text, domain, name, status, last_crawled_at FROM public.sources ORDER BY domain`
    )) as any[];
    for (const s of sources) console.log(`  - ${s.domain} (${s.name}) - status: ${s.status}`);

    // 2. Crawl runs - historico
    console.log("\n## 2. Crawl runs - ultimos 10\n");
    const runs = (await db.$queryRawUnsafe(
      `SELECT cr.id::text, s.domain, cr.status, cr.pages_crawled, cr.listings_extracted, cr.started_at
       FROM public.crawl_runs cr
       JOIN public.sources s ON s.id = cr.source_id
       ORDER BY cr.started_at DESC LIMIT 10`
    )) as any[];
    for (const r of runs)
      console.log(`  - ${r.domain}: ${r.status}, ${r.pages_crawled}p, ${r.listings_extracted}l (${r.started_at.toISOString().slice(0, 16)})`);

    // 3. Distribuciones clave
    console.log("\n## 3. Distribucion de listing_type\n");
    const listingTypes = (await db.$queryRawUnsafe(
      `SELECT listing_type, COUNT(*)::int as n FROM public.properties GROUP BY listing_type ORDER BY n DESC`
    )) as any[];
    for (const l of listingTypes) console.log(`  ${l.listing_type}: ${l.n}`);

    console.log("\n## 4. Distribucion de property_type\n");
    const propTypes = (await db.$queryRawUnsafe(
      `SELECT property_type, COUNT(*)::int as n FROM public.properties GROUP BY property_type ORDER BY n DESC`
    )) as any[];
    for (const p of propTypes) console.log(`  ${p.property_type}: ${p.n}`);

    console.log("\n## 5. Distribucion de status\n");
    const statuses = (await db.$queryRawUnsafe(
      `SELECT status, COUNT(*)::int as n FROM public.properties GROUP BY status ORDER BY n DESC`
    )) as any[];
    for (const s of statuses) console.log(`  ${s.status}: ${s.n}`);

    console.log("\n## 6. Con vs sin development_name\n");
    const devName = (await db.$queryRawUnsafe(
      `SELECT
         CASE WHEN development_name IS NULL THEN 'SIN development_name' ELSE 'CON development_name' END as grupo,
         COUNT(*)::int as n
       FROM public.properties GROUP BY grupo`
    )) as any[];
    for (const d of devName) console.log(`  ${d.grupo}: ${d.n}`);

    console.log("\n## 7. Top 10 development_name (mas comunes)\n");
    const topDevs = (await db.$queryRawUnsafe(
      `SELECT development_name, COUNT(*)::int as n
       FROM public.properties WHERE development_name IS NOT NULL
       GROUP BY development_name ORDER BY n DESC LIMIT 10`
    )) as any[];
    for (const d of topDevs) console.log(`  "${d.development_name}": ${d.n} props`);

    console.log("\n## 8. Distribucion por source\n");
    const bySource = (await db.$queryRawUnsafe(
      `SELECT s.domain, COUNT(p.id)::int as n
       FROM public.properties p JOIN public.sources s ON s.id = p.source_id
       GROUP BY s.domain ORDER BY n DESC`
    )) as any[];
    for (const b of bySource) console.log(`  ${b.domain}: ${b.n} props`);

    console.log("\n## 9. Distribucion geografica\n");
    const geo = (await db.$queryRawUnsafe(
      `SELECT state, city, COUNT(*)::int as n
       FROM public.properties GROUP BY state, city ORDER BY n DESC LIMIT 15`
    )) as any[];
    for (const g of geo) console.log(`  ${g.state} / ${g.city}: ${g.n}`);

    // 4. Ejemplo de fila completa
    console.log("\n## 10. Ejemplo de property (1 fila)\n");
    const sample = (await db.$queryRawUnsafe(
      `SELECT id::text, title, property_type, listing_type, price_cents, currency,
              bedrooms, bathrooms, construction_m2, land_m2, parking_spaces,
              developer_name, development_name, state, city, neighborhood,
              status, jsonb_typeof(raw_data) as raw_type,
              jsonb_object_keys(raw_data) as raw_keys
       FROM public.properties LIMIT 1`
    )) as any[];
    if (sample.length > 0) {
      const s = sample[0];
      console.log(`  id: ${s.id}`);
      console.log(`  title: ${s.title}`);
      console.log(`  property_type: ${s.property_type}`);
      console.log(`  listing_type: ${s.listing_type}`);
      console.log(`  price: ${s.price_cents} ${s.currency}`);
      console.log(`  rooms: ${s.bedrooms}br ${s.bathrooms}ba ${s.construction_m2}m2 ${s.parking_spaces}park`);
      console.log(`  developer: ${s.developer_name} | development: ${s.development_name}`);
      console.log(`  location: ${s.state} / ${s.city} / ${s.neighborhood}`);
      console.log(`  status: ${s.status}`);
    }

    // 5. Keys de raw_data (heterogeneas entre sources)
    console.log("\n## 11. Claves comunes en raw_data (jsonb)\n");
    const rawKeys = (await db.$queryRawUnsafe(
      `SELECT k.key, COUNT(*)::int as n
       FROM public.properties p, jsonb_object_keys(p.raw_data) k(key)
       WHERE p.raw_data != '{}'::jsonb
       GROUP BY k.key ORDER BY n DESC LIMIT 30`
    )) as any[];
    for (const k of rawKeys) console.log(`  ${k.key}: ${k.n} props`);

    // 6. Keys en extracted_data
    console.log("\n## 12. Claves comunes en extracted_data (jsonb)\n");
    const extKeys = (await db.$queryRawUnsafe(
      `SELECT k.key, COUNT(*)::int as n
       FROM public.properties p, jsonb_object_keys(p.extracted_data) k(key)
       WHERE p.extracted_data != '{}'::jsonb
       GROUP BY k.key ORDER BY n DESC LIMIT 30`
    )) as any[];
    for (const k of extKeys) console.log(`  ${k.key}: ${k.n} props`);

    // 7. Imagenes por propiedad
    console.log("\n## 13. Imagenes - distribucion\n");
    const imgs = (await db.$queryRawUnsafe(
      `SELECT
         CASE
           WHEN n = 0 THEN 'sin imagenes'
           WHEN n BETWEEN 1 AND 5 THEN '1-5'
           WHEN n BETWEEN 6 AND 20 THEN '6-20'
           ELSE '20+'
         END as rango,
         COUNT(*)::int as props
       FROM (
         SELECT p.id, COUNT(pi.id)::int as n
         FROM public.properties p
         LEFT JOIN public.property_images pi ON pi.property_id = p.id
         GROUP BY p.id
       ) t
       GROUP BY rango ORDER BY rango`
    )) as any[];
    for (const i of imgs) console.log(`  ${i.rango}: ${i.props} props`);

    // 8. Amenidades disponibles
    console.log("\n## 14. Amenidades catalogadas\n");
    const amenities = (await db.$queryRawUnsafe(
      `SELECT slug, name_es, category FROM public.amenities ORDER BY category, name_es`
    )) as any[];
    for (const a of amenities) console.log(`  ${a.category ?? '(sin cat)'}: ${a.slug} (${a.name_es})`);
    if (amenities.length === 0) console.log("  (vacio)");

    console.log("\n============================================\n");
  } finally {
    await db.$disconnect();
  }
}
main();
