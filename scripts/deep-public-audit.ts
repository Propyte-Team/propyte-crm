/**
 * deep-public-audit.ts
 * Diagnóstico profundo del schema public para encontrar datos revueltos/fallidos.
 * Corre: npx tsx scripts/deep-public-audit.ts
 */
import { getDb, closeDb } from "../src/robots/shared/db";

async function main() {
  const db = getDb();
  console.log("=".repeat(70));
  console.log("AUDITORÍA PROFUNDA — schema public");
  console.log("=".repeat(70));

  // ─── 1. CIUDADES DUPLICADAS POR NORMALIZACIÓN ─────────────────
  console.log("\n## 1. Ciudades duplicadas (misma ciudad, diferente escritura)\n");
  const cities = await db.$queryRawUnsafe<any[]>(`
    SELECT city, state, COUNT(*) as cnt
    FROM public.properties
    WHERE status IN ('review','published')
    GROUP BY city, state
    ORDER BY lower(regexp_replace(city, '[^a-zA-Z]', '', 'g')) ASC, cnt DESC
  `);
  const cityNorm: Record<string, { variants: { city: string; state: string; cnt: number }[] }> = {};
  for (const r of cities) {
    const key = r.city?.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z]/g, "") || "_null_";
    if (!cityNorm[key]) cityNorm[key] = { variants: [] };
    cityNorm[key].variants.push({ city: r.city, state: r.state, cnt: Number(r.cnt) });
  }
  for (const [key, val] of Object.entries(cityNorm)) {
    if (val.variants.length > 1) {
      const total = val.variants.reduce((s, v) => s + v.cnt, 0);
      console.log(`  🔴 "${key}" tiene ${val.variants.length} variantes (${total} props total):`);
      for (const v of val.variants) {
        console.log(`     - "${v.city}" / ${v.state}: ${v.cnt}`);
      }
    }
  }

  // ─── 2. DEVELOPER_NAME VS DEVELOPMENT_NAME CRUZADOS ──────────
  console.log("\n## 2. Developer asignado a múltiples ciudades/estados\n");
  const devMultiCity = await db.$queryRawUnsafe<any[]>(`
    SELECT developer_name,
           array_agg(DISTINCT state) as states,
           array_agg(DISTINCT city) as cities,
           COUNT(*) as cnt
    FROM public.properties
    WHERE status IN ('review','published')
      AND developer_name IS NOT NULL
    GROUP BY developer_name
    HAVING COUNT(DISTINCT state) > 1 OR COUNT(DISTINCT city) > 3
    ORDER BY cnt DESC
    LIMIT 30
  `);
  if (devMultiCity.length === 0) console.log("  ✅ Ningún developer con estados mixtos");
  for (const r of devMultiCity) {
    console.log(`  🟡 "${r.developer_name}" (${r.cnt} props) → estados: [${r.states.join(", ")}] ciudades: [${r.cities.join(", ")}]`);
  }

  // ─── 3. DESARROLLO CON PROPERTIES EN DIFERENTES CIUDADES ─────
  console.log("\n## 3. Desarrollos con propiedades en diferentes ciudades (datos revueltos)\n");
  const devMixedCity = await db.$queryRawUnsafe<any[]>(`
    SELECT development_name,
           array_agg(DISTINCT city) as cities,
           array_agg(DISTINCT state) as states,
           COUNT(*) as cnt,
           array_agg(DISTINCT s.domain) as sources
    FROM public.properties p
    JOIN public.sources s ON s.id = p.source_id
    WHERE p.status IN ('review','published')
      AND p.development_name IS NOT NULL
    GROUP BY development_name
    HAVING COUNT(DISTINCT city) > 1
    ORDER BY COUNT(DISTINCT city) DESC, cnt DESC
    LIMIT 30
  `);
  if (devMixedCity.length === 0) console.log("  ✅ Ningún desarrollo con ciudades mixtas");
  for (const r of devMixedCity) {
    console.log(`  🔴 "${r.development_name}" (${r.cnt} props) → ciudades: [${r.cities.join(", ")}] estados: [${r.states.join(", ")}] fuentes: [${r.sources.join(", ")}]`);
  }

  // ─── 4. PROPERTIES SIN CAMPOS CRÍTICOS ───────────────────────
  console.log("\n## 4. Properties activas con campos críticos NULL\n");
  const nullChecks = await db.$queryRawUnsafe<any[]>(`
    SELECT
      COUNT(*) FILTER (WHERE city IS NULL) as city_null,
      COUNT(*) FILTER (WHERE state IS NULL) as state_null,
      COUNT(*) FILTER (WHERE development_name IS NULL) as dev_name_null,
      COUNT(*) FILTER (WHERE developer_name IS NULL) as developer_null,
      COUNT(*) FILTER (WHERE price_cents IS NULL OR price_cents = 0) as price_null,
      COUNT(*) FILTER (WHERE property_type IS NULL) as type_null,
      COUNT(*) FILTER (WHERE listing_type IS NULL) as listing_null,
      COUNT(*) FILTER (WHERE latitude IS NULL) as lat_null,
      COUNT(*) FILTER (WHERE longitude IS NULL) as lng_null,
      COUNT(*) FILTER (WHERE construction_m2 IS NULL) as m2_null,
      COUNT(*) FILTER (WHERE bedrooms IS NULL) as beds_null,
      COUNT(*) FILTER (WHERE bathrooms IS NULL) as baths_null,
      COUNT(*) FILTER (WHERE neighborhood IS NULL) as neighborhood_null,
      COUNT(*) FILTER (WHERE content_es IS NULL) as content_es_null,
      COUNT(*) FILTER (WHERE content_en IS NULL) as content_en_null,
      COUNT(*) as total
    FROM public.properties
    WHERE status IN ('review','published')
  `);
  const n = nullChecks[0];
  const pct = (v: number) => `${v} (${((v / Number(n.total)) * 100).toFixed(1)}%)`;
  console.log(`  Total activas (review+published): ${n.total}`);
  console.log(`  city NULL:           ${pct(Number(n.city_null))}`);
  console.log(`  state NULL:          ${pct(Number(n.state_null))}`);
  console.log(`  development_name:    ${pct(Number(n.dev_name_null))}`);
  console.log(`  developer_name:      ${pct(Number(n.developer_null))}`);
  console.log(`  price NULL/0:        ${pct(Number(n.price_null))}`);
  console.log(`  property_type NULL:  ${pct(Number(n.type_null))}`);
  console.log(`  listing_type NULL:   ${pct(Number(n.listing_null))}`);
  console.log(`  lat/lng NULL:        ${pct(Number(n.lat_null))} / ${pct(Number(n.lng_null))}`);
  console.log(`  m2 NULL:             ${pct(Number(n.m2_null))}`);
  console.log(`  bedrooms NULL:       ${pct(Number(n.beds_null))}`);
  console.log(`  bathrooms NULL:      ${pct(Number(n.baths_null))}`);
  console.log(`  neighborhood NULL:   ${pct(Number(n.neighborhood_null))}`);
  console.log(`  content_es NULL:     ${pct(Number(n.content_es_null))}`);
  console.log(`  content_en NULL:     ${pct(Number(n.content_en_null))}`);

  // ─── 5. MAYAOCEAN (NUEVA FUENTE) — CALIDAD ───────────────────
  console.log("\n## 5. Calidad de datos por fuente (source)\n");
  const qualityBySource = await db.$queryRawUnsafe<any[]>(`
    SELECT
      s.domain,
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE p.status = 'published') as published,
      COUNT(*) FILTER (WHERE p.status = 'review') as review,
      COUNT(*) FILTER (WHERE p.status = 'possible_duplicate') as dupes,
      COUNT(*) FILTER (WHERE p.status = 'draft') as draft,
      COUNT(*) FILTER (WHERE p.developer_name IS NOT NULL) as has_developer,
      COUNT(*) FILTER (WHERE p.development_name IS NOT NULL) as has_dev_name,
      COUNT(*) FILTER (WHERE p.price_cents IS NOT NULL AND p.price_cents > 0) as has_price,
      COUNT(*) FILTER (WHERE p.city IS NOT NULL) as has_city,
      COUNT(*) FILTER (WHERE p.latitude IS NOT NULL) as has_coords,
      COUNT(*) FILTER (WHERE p.content_es IS NOT NULL) as has_content,
      COUNT(*) FILTER (WHERE p.bedrooms IS NOT NULL) as has_bedrooms,
      COUNT(*) FILTER (WHERE p.construction_m2 IS NOT NULL) as has_m2,
      COUNT(*) FILTER (WHERE p.neighborhood IS NOT NULL) as has_neighborhood
    FROM public.properties p
    JOIN public.sources s ON s.id = p.source_id
    GROUP BY s.domain
    ORDER BY total DESC
  `);
  for (const r of qualityBySource) {
    const t = Number(r.total);
    const pf = (v: any) => `${Number(v)}/${t} (${((Number(v) / t) * 100).toFixed(0)}%)`;
    console.log(`\n  📊 ${r.domain} (${t} total)`);
    console.log(`     Status: pub=${r.published} rev=${r.review} dup=${r.dupes} draft=${r.draft}`);
    console.log(`     developer_name: ${pf(r.has_developer)}`);
    console.log(`     development_name: ${pf(r.has_dev_name)}`);
    console.log(`     price: ${pf(r.has_price)}`);
    console.log(`     city: ${pf(r.has_city)}`);
    console.log(`     coords: ${pf(r.has_coords)}`);
    console.log(`     content_es: ${pf(r.has_content)}`);
    console.log(`     bedrooms: ${pf(r.has_bedrooms)}`);
    console.log(`     m2: ${pf(r.has_m2)}`);
    console.log(`     neighborhood: ${pf(r.has_neighborhood)}`);
  }

  // ─── 6. MAYAOCEAN — SAMPLE DE DATOS ──────────────────────────
  console.log("\n## 6. Muestra de datos de mayaocean.com (nueva fuente)\n");
  const mayaSample = await db.$queryRawUnsafe<any[]>(`
    SELECT p.title, p.developer_name, p.development_name, p.city, p.state,
           p.neighborhood, p.property_type, p.listing_type, p.status,
           p.price_cents, p.currency, p.bedrooms, p.bathrooms, p.construction_m2,
           p.latitude, p.longitude,
           (p.content_es IS NOT NULL) as has_content_es,
           (p.raw_data->'amenities' IS NOT NULL) as has_amenities
    FROM public.properties p
    JOIN public.sources s ON s.id = p.source_id
    WHERE s.domain = 'mayaocean.com'
    ORDER BY p.first_seen_at DESC NULLS LAST
    LIMIT 15
  `);
  for (const r of mayaSample) {
    console.log(`  - "${r.development_name || '(NULL)'}" by ${r.developer_name || '(NULL)'}`);
    console.log(`    ${r.city}/${r.state} | ${r.property_type} ${r.listing_type} | ${r.status}`);
    console.log(`    price=${r.price_cents ? Number(r.price_cents) / 100 : 'NULL'} ${r.currency || ''} | ${r.bedrooms || '-'}br ${r.bathrooms || '-'}ba ${r.construction_m2 || '-'}m2`);
    console.log(`    coords=${r.latitude ? 'yes' : 'NULL'} content=${r.has_content_es ? 'yes' : 'NULL'} amenities=${r.has_amenities ? 'yes' : 'NULL'}`);
  }

  // ─── 7. SLUG DUPLICADOS QUE CAUSAN ERRORES ───────────────────
  console.log("\n## 7. slug_adjective genéricos que causan colisiones\n");
  const slugIssues = await db.$queryRawUnsafe<any[]>(`
    SELECT p.slug_adjective, COUNT(*) as cnt
    FROM public.properties p
    WHERE p.status IN ('review','published')
      AND p.slug_adjective IS NOT NULL
    GROUP BY p.slug_adjective
    HAVING COUNT(*) > 1
    ORDER BY cnt DESC
    LIMIT 20
  `);
  for (const r of slugIssues) {
    console.log(`  ⚠️  "${r.slug_adjective}" aparece ${r.cnt} veces`);
  }

  // ─── 8. PROPERTIES CON DEVELOPER_NAME = DEVELOPMENT_NAME ─────
  console.log("\n## 8. Properties donde developer_name = development_name (confusión)\n");
  const devNameConfusion = await db.$queryRawUnsafe<any[]>(`
    SELECT developer_name, development_name, COUNT(*) as cnt
    FROM public.properties
    WHERE status IN ('review','published')
      AND developer_name IS NOT NULL
      AND development_name IS NOT NULL
      AND lower(trim(developer_name)) = lower(trim(development_name))
    GROUP BY developer_name, development_name
    ORDER BY cnt DESC
    LIMIT 15
  `);
  if (devNameConfusion.length === 0) console.log("  ✅ No hay confusión developer/development");
  for (const r of devNameConfusion) {
    console.log(`  🔴 "${r.developer_name}" = "${r.development_name}" (${r.cnt} props)`);
  }

  // ─── 9. PRECIO SOSPECHOSO (MUY ALTO O MUY BAJO) ─────────────
  console.log("\n## 9. Precios sospechosos (outliers)\n");
  const priceOutliers = await db.$queryRawUnsafe<any[]>(`
    SELECT title, development_name, price_cents, currency, city,
           s.domain as source,
           CASE
             WHEN currency = 'USD' THEN price_cents / 100.0
             ELSE price_cents / 100.0
           END as price_display
    FROM public.properties p
    JOIN public.sources s ON s.id = p.source_id
    WHERE p.status IN ('review','published')
      AND p.price_cents IS NOT NULL
      AND (
        (p.currency = 'MXN' AND p.price_cents > 50000000000) -- >500M MXN
        OR (p.currency = 'USD' AND p.price_cents > 5000000000) -- >50M USD
        OR (p.currency = 'MXN' AND p.price_cents < 10000000 AND p.price_cents > 0) -- <100K MXN
        OR (p.currency = 'USD' AND p.price_cents < 100000 AND p.price_cents > 0) -- <1K USD
      )
    ORDER BY price_cents DESC
    LIMIT 20
  `);
  if (priceOutliers.length === 0) console.log("  ✅ No hay precios sospechosos");
  for (const r of priceOutliers) {
    const price = Number(r.price_display).toLocaleString();
    console.log(`  ⚠️  $${price} ${r.currency} | "${r.development_name || r.title}" | ${r.city} | src: ${r.source}`);
  }

  // ─── 10. POSSIBLE_DUPLICATE — ANÁLISIS ───────────────────────
  console.log("\n## 10. Possible duplicates — ¿qué nombres de desarrollo están duplicados?\n");
  const dupeAnalysis = await db.$queryRawUnsafe<any[]>(`
    SELECT development_name, COUNT(*) as cnt,
           array_agg(DISTINCT s.domain) as sources
    FROM public.properties p
    JOIN public.sources s ON s.id = p.source_id
    WHERE p.status = 'possible_duplicate'
      AND p.development_name IS NOT NULL
    GROUP BY development_name
    ORDER BY cnt DESC
    LIMIT 15
  `);
  console.log(`  Total possible_duplicates: ${(await db.$queryRawUnsafe<any[]>(`SELECT COUNT(*) as c FROM public.properties WHERE status='possible_duplicate'`))[0].c}`);
  for (const r of dupeAnalysis) {
    console.log(`  - "${r.development_name}" × ${r.cnt} (fuentes: ${r.sources.join(", ")})`);
  }

  // ─── 11. DEVELOPMENT_NAME EN MAYAOCEAN VS OTRAS FUENTES ──────
  console.log("\n## 11. Colisiones de development_name entre mayaocean y otras fuentes\n");
  const crossSource = await db.$queryRawUnsafe<any[]>(`
    WITH maya AS (
      SELECT DISTINCT lower(trim(development_name)) as dn
      FROM public.properties p
      JOIN public.sources s ON s.id = p.source_id
      WHERE s.domain = 'mayaocean.com'
        AND development_name IS NOT NULL
    ),
    others AS (
      SELECT DISTINCT lower(trim(development_name)) as dn, s.domain
      FROM public.properties p
      JOIN public.sources s ON s.id = p.source_id
      WHERE s.domain != 'mayaocean.com'
        AND development_name IS NOT NULL
    )
    SELECT m.dn, array_agg(DISTINCT o.domain) as other_sources
    FROM maya m
    JOIN others o ON m.dn = o.dn
    GROUP BY m.dn
    ORDER BY m.dn
    LIMIT 30
  `);
  console.log(`  Desarrollos en mayaocean que TAMBIÉN están en otras fuentes: ${crossSource.length}`);
  for (const r of crossSource) {
    console.log(`    - "${r.dn}" → también en: ${r.other_sources.join(", ")}`);
  }

  // ─── 12. CAMPOS RAW_DATA QUE MAYAOCEAN TIENE DIFERENTE ───────
  console.log("\n## 12. Estructura raw_data de mayaocean vs goodlers (diff)\n");
  const rawKeys = await db.$queryRawUnsafe<any[]>(`
    SELECT s.domain,
           jsonb_object_keys(p.raw_data) as key,
           COUNT(*) as cnt
    FROM public.properties p
    JOIN public.sources s ON s.id = p.source_id
    WHERE s.domain IN ('mayaocean.com', 'goodlers.com')
    GROUP BY s.domain, jsonb_object_keys(p.raw_data)
    ORDER BY s.domain, cnt DESC
  `);
  const byDomain: Record<string, Record<string, number>> = {};
  for (const r of rawKeys) {
    if (!byDomain[r.domain]) byDomain[r.domain] = {};
    byDomain[r.domain][r.key] = Number(r.cnt);
  }
  const allKeys = new Set([...Object.keys(byDomain["mayaocean.com"] || {}), ...Object.keys(byDomain["goodlers.com"] || {})]);
  console.log(`\n  ${"Key".padEnd(25)} ${"mayaocean".padEnd(12)} ${"goodlers".padEnd(12)}`);
  console.log(`  ${"-".repeat(49)}`);
  for (const k of [...allKeys].sort()) {
    const m = byDomain["mayaocean.com"]?.[k] || 0;
    const g = byDomain["goodlers.com"]?.[k] || 0;
    const flag = (m === 0 || g === 0) ? " ◀◀" : "";
    console.log(`  ${k.padEnd(25)} ${String(m).padEnd(12)} ${String(g).padEnd(12)}${flag}`);
  }

  // ─── 13. CONTENT_ES STRUCTURE CHECK ──────────────────────────
  console.log("\n## 13. Estructura de content_es — campos presentes por fuente\n");
  const contentKeys = await db.$queryRawUnsafe<any[]>(`
    SELECT s.domain,
           COUNT(*) FILTER (WHERE p.content_es IS NOT NULL) as has_content,
           COUNT(*) FILTER (WHERE p.content_es->>'metaTitle' IS NOT NULL) as has_meta_title,
           COUNT(*) FILTER (WHERE p.content_es->'hero' IS NOT NULL) as has_hero,
           COUNT(*) FILTER (WHERE p.content_es->'hero'->>'intro' IS NOT NULL) as has_intro,
           COUNT(*) FILTER (WHERE p.content_es->'hero'->>'h1' IS NOT NULL) as has_h1,
           COUNT(*) FILTER (WHERE p.content_es->'features' IS NOT NULL) as has_features,
           COUNT(*) FILTER (WHERE p.content_es->'faq' IS NOT NULL) as has_faq,
           COUNT(*) FILTER (WHERE p.content_es->'location' IS NOT NULL) as has_location,
           COUNT(*) FILTER (WHERE p.content_es->'lifestyle' IS NOT NULL) as has_lifestyle,
           COUNT(*) as total
    FROM public.properties p
    JOIN public.sources s ON s.id = p.source_id
    WHERE p.status IN ('review','published')
    GROUP BY s.domain
    ORDER BY total DESC
  `);
  for (const r of contentKeys) {
    console.log(`\n  📝 ${r.domain} (${r.total} activas)`);
    console.log(`     content_es: ${r.has_content} | metaTitle: ${r.has_meta_title} | hero: ${r.has_hero}`);
    console.log(`     intro: ${r.has_intro} | h1: ${r.has_h1} | features: ${r.has_features}`);
    console.log(`     faq: ${r.has_faq} | location: ${r.has_location} | lifestyle: ${r.has_lifestyle}`);
  }

  // ─── 14. COORDENADAS FUERA DE RANGO MEXICO ───────────────────
  console.log("\n## 14. Coordenadas fuera de rango México (posible dato incorrecto)\n");
  const badCoords = await db.$queryRawUnsafe<any[]>(`
    SELECT development_name, city, state, latitude, longitude, s.domain
    FROM public.properties p
    JOIN public.sources s ON s.id = p.source_id
    WHERE p.status IN ('review','published')
      AND p.latitude IS NOT NULL
      AND (p.latitude < 14 OR p.latitude > 33 OR p.longitude < -120 OR p.longitude > -86)
    LIMIT 20
  `);
  if (badCoords.length === 0) console.log("  ✅ Todas las coordenadas dentro de rango México");
  for (const r of badCoords) {
    console.log(`  🔴 "${r.development_name}" ${r.city}/${r.state} → lat=${r.latitude} lng=${r.longitude} (src: ${r.domain})`);
  }

  // ─── 15. ESTADO INCONSISTENTE CON CIUDAD ─────────────────────
  console.log("\n## 15. Estado inconsistente con ciudad conocida\n");
  const stateMismatch = await db.$queryRawUnsafe<any[]>(`
    SELECT city, state, COUNT(*) as cnt
    FROM public.properties
    WHERE status IN ('review','published')
      AND (
        (lower(city) LIKE '%merida%' AND state != 'Yucatán')
        OR (lower(city) LIKE '%tulum%' AND state != 'Quintana Roo')
        OR (lower(city) LIKE '%cancun%' AND state != 'Quintana Roo')
        OR (lower(city) LIKE '%playa del carmen%' AND state != 'Quintana Roo')
        OR (lower(city) LIKE '%valladolid%' AND state != 'Yucatán')
        OR (lower(city) LIKE '%cozumel%' AND state != 'Quintana Roo')
      )
    GROUP BY city, state
    ORDER BY cnt DESC
  `);
  if (stateMismatch.length === 0) console.log("  ✅ No hay inconsistencias estado/ciudad");
  for (const r of stateMismatch) {
    console.log(`  🔴 "${r.city}" clasificada como "${r.state}" (${r.cnt} props)`);
  }

  console.log("\n" + "=".repeat(70));
  console.log("FIN DE AUDITORÍA");
  console.log("=".repeat(70));

  await closeDb();
}

main().catch((e) => { console.error(e); process.exit(1); });
