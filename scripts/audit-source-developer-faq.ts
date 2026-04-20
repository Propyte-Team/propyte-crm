/**
 * audit-source-developer-faq.ts
 * Investiga: 1) fuentes como developer, 2) estructura content_es, 3) FAQs
 */
import { getDb, closeDb } from "../src/robots/shared/db";

async function main() {
  const db = getDb();

  // ─── 1. DEVELOPER NAMES QUE SON REALMENTE FUENTES/BROKERS ────
  console.log("## 1. Developer names que parecen fuentes/brokers/agencias\n");
  const sourceDevs = await db.$queryRawUnsafe<any[]>(`
    SELECT p.developer_name, s.domain, COUNT(*) as cnt,
           array_agg(DISTINCT p.development_name) FILTER (WHERE p.development_name IS NOT NULL) as dev_names
    FROM public.properties p
    JOIN public.sources s ON s.id = p.source_id
    WHERE p.status IN ('review','published')
      AND p.developer_name IS NOT NULL
      AND (
        lower(p.developer_name) LIKE '%plalla%'
        OR lower(p.developer_name) LIKE '%goodlers%'
        OR lower(p.developer_name) LIKE '%caribe luxury%'
        OR lower(p.developer_name) LIKE '%propiedades cancun%'
        OR lower(p.developer_name) LIKE '%maya ocean%'
        OR lower(p.developer_name) LIKE '%mayaocean%'
        OR lower(p.developer_name) LIKE '%luumo%'
        OR lower(p.developer_name) LIKE '%noval%'
        OR lower(p.developer_name) LIKE '%real estate%'
        OR lower(p.developer_name) LIKE '%inmobiliaria%'
        OR lower(p.developer_name) LIKE '%bienes raices%'
        OR lower(p.developer_name) LIKE '%realty%'
        OR lower(p.developer_name) LIKE '%broker%'
        OR lower(p.developer_name) LIKE '%sales center%'
        OR lower(p.developer_name) LIKE '%investment%'
        OR lower(p.developer_name) LIKE '%agency%'
        OR lower(p.developer_name) LIKE '%consulting%'
        OR lower(p.developer_name) LIKE '%advisors%'
        OR lower(p.developer_name) LIKE '%properties%'
        OR lower(p.developer_name) LIKE '%riviera maya%'
      )
    GROUP BY p.developer_name, s.domain
    ORDER BY cnt DESC
  `);
  console.log(`  Total developer_names sospechosos: ${sourceDevs.length}\n`);
  for (const r of sourceDevs) {
    const devNames = r.dev_names ? r.dev_names.slice(0, 5).join(", ") : "(none)";
    console.log(`  🔴 "${r.developer_name}" (${r.cnt} props, src: ${r.domain})`);
    console.log(`     desarrollos: ${devNames}`);
    if (r.dev_names && r.dev_names.length > 5) console.log(`     ... y ${r.dev_names.length - 5} más`);
  }

  // ─── 2. TODOS LOS DEVELOPER_NAME ÚNICOS POR FUENTE ──────────
  console.log("\n## 2. Developer names por fuente (para detectar patrones)\n");
  const devsBySource = await db.$queryRawUnsafe<any[]>(`
    SELECT s.domain, p.developer_name, COUNT(*) as cnt
    FROM public.properties p
    JOIN public.sources s ON s.id = p.source_id
    WHERE p.status IN ('review','published')
      AND p.developer_name IS NOT NULL
    GROUP BY s.domain, p.developer_name
    ORDER BY s.domain, cnt DESC
  `);
  const bySource: Record<string, { name: string; cnt: number }[]> = {};
  for (const r of devsBySource) {
    if (!bySource[r.domain]) bySource[r.domain] = [];
    bySource[r.domain].push({ name: r.developer_name, cnt: Number(r.cnt) });
  }
  for (const [domain, devs] of Object.entries(bySource)) {
    console.log(`\n  📊 ${domain} (${devs.length} developer_names únicos):`);
    for (const d of devs.slice(0, 15)) {
      console.log(`     [${d.cnt}] ${d.name}`);
    }
    if (devs.length > 15) console.log(`     ... +${devs.length - 15} más`);
  }

  // ─── 3. CONTENT_ES ESTRUCTURA POR FUENTE ─────────────────────
  console.log("\n\n## 3. Estructura content_es — ejemplo por fuente\n");
  const sources = ["mayaocean.com", "goodlers.com", "plalla.com", "propiedadescancun.mx"];
  for (const src of sources) {
    const sample = await db.$queryRawUnsafe<any[]>(`
      SELECT p.content_es, p.development_name, p.developer_name
      FROM public.properties p
      JOIN public.sources s ON s.id = p.source_id
      WHERE s.domain = $1
        AND p.content_es IS NOT NULL
        AND p.status IN ('review','published')
      LIMIT 1
    `, src);
    if (sample.length > 0) {
      const c = sample[0].content_es;
      console.log(`  📋 ${src} — "${sample[0].development_name}" by "${sample[0].developer_name}"`);
      console.log(`    Top-level keys: ${Object.keys(c).join(", ")}`);
      if (c.hero) console.log(`    hero keys: ${Object.keys(c.hero).join(", ")}`);
      if (c.hero?.intro) console.log(`    hero.intro (first 150): ${String(c.hero.intro).substring(0, 150)}...`);
      if (c.features) console.log(`    features keys: ${Object.keys(c.features).join(", ")}`);
      if (c.location) console.log(`    location keys: ${Object.keys(c.location).join(", ")}`);
      if (c.lifestyle) console.log(`    lifestyle keys: ${Object.keys(c.lifestyle).join(", ")}`);
      if (c.faq && Array.isArray(c.faq)) {
        console.log(`    faq: ${c.faq.length} items`);
        if (c.faq.length > 0) {
          console.log(`    faq[0] keys: ${Object.keys(c.faq[0]).join(", ")}`);
          console.log(`    faq[0]: Q="${String(c.faq[0].question || c.faq[0].pregunta || "?").substring(0, 100)}"`);
          console.log(`           A="${String(c.faq[0].answer || c.faq[0].respuesta || "?").substring(0, 100)}"`);
        }
      }
      console.log(`    metaTitle: ${c.metaTitle ? String(c.metaTitle).substring(0, 80) : "NULL"}`);
      console.log(`    metaDescription: ${c.metaDescription ? String(c.metaDescription).substring(0, 80) : "NULL"}`);
      console.log();
    }
  }

  // ─── 4. FAQ COBERTURA ────────────────────────────────────────
  console.log("## 4. FAQs en content_es — cobertura por fuente\n");
  const faqStats = await db.$queryRawUnsafe<any[]>(`
    SELECT s.domain,
           COUNT(*) FILTER (WHERE p.content_es->'faq' IS NOT NULL
             AND jsonb_typeof(p.content_es->'faq') = 'array'
             AND jsonb_array_length(p.content_es->'faq') > 0) as has_faq,
           COUNT(*) FILTER (WHERE p.content_es IS NOT NULL) as has_content,
           COUNT(*) as total,
           ROUND(AVG(jsonb_array_length(p.content_es->'faq')) FILTER (
             WHERE p.content_es->'faq' IS NOT NULL
             AND jsonb_typeof(p.content_es->'faq') = 'array'
             AND jsonb_array_length(p.content_es->'faq') > 0
           ), 1) as avg_faq
    FROM public.properties p
    JOIN public.sources s ON s.id = p.source_id
    WHERE p.status IN ('review','published')
    GROUP BY s.domain
    ORDER BY total DESC
  `);
  for (const r of faqStats) {
    console.log(`  ${r.domain}: ${r.has_faq}/${r.has_content} con FAQs (avg ${r.avg_faq || 0} preguntas) — total: ${r.total}`);
  }

  // ─── 5. COLUMNAS FAQ EN REAL_ESTATE_HUB ──────────────────────
  console.log("\n## 5. Columnas FAQ existentes en real_estate_hub\n");
  const faqCols = await db.$queryRawUnsafe<any[]>(`
    SELECT table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'real_estate_hub'
      AND (lower(column_name) LIKE '%faq%' OR lower(column_name) LIKE '%pregunta%')
    ORDER BY table_name, column_name
  `);
  if (faqCols.length === 0) console.log("  ❌ No hay columnas con 'faq' o 'pregunta' en real_estate_hub");
  for (const r of faqCols) {
    console.log(`  ${r.table_name}.${r.column_name} (${r.data_type})`);
  }

  // Check views
  const viewFaq = await db.$queryRawUnsafe<any[]>(`
    SELECT table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'real_estate_hub'
      AND table_name IN ('v_developments', 'v_units')
      AND (lower(column_name) LIKE '%faq%' OR lower(column_name) LIKE '%content%')
    ORDER BY table_name, column_name
  `);
  console.log("\n  Columnas FAQ/content en vistas:");
  for (const r of viewFaq) {
    console.log(`  ${r.table_name}.${r.column_name} (${r.data_type})`);
  }

  // ─── 6. VERIFICAR QUE FAQs LLEGAN A REAL_ESTATE_HUB ─────────
  console.log("\n## 6. FAQs en real_estate_hub — ¿están llegando?\n");
  const hubFaqs = await db.$queryRawUnsafe<any[]>(`
    SELECT
      COUNT(*) as total_desarrollos,
      COUNT(*) FILTER (WHERE ext_content_es IS NOT NULL) as has_content,
      COUNT(*) FILTER (WHERE ext_content_es->'faq' IS NOT NULL
        AND jsonb_typeof(ext_content_es->'faq') = 'array'
        AND jsonb_array_length(ext_content_es->'faq') > 0) as has_faq
    FROM real_estate_hub."Propyte_desarrollos"
    WHERE deleted_at IS NULL
  `);
  console.log(`  Propyte_desarrollos: ${hubFaqs[0].has_faq}/${hubFaqs[0].total_desarrollos} con FAQs (${hubFaqs[0].has_content} con content_es)`);

  const hubFaqUnits = await db.$queryRawUnsafe<any[]>(`
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE ext_content_es IS NOT NULL) as has_content,
      COUNT(*) FILTER (WHERE ext_content_es->'faq' IS NOT NULL
        AND jsonb_typeof(ext_content_es->'faq') = 'array'
        AND jsonb_array_length(ext_content_es->'faq') > 0) as has_faq
    FROM real_estate_hub."Propyte_unidades"
    WHERE deleted_at IS NULL
  `);
  console.log(`  Propyte_unidades: ${hubFaqUnits[0].has_faq}/${hubFaqUnits[0].total} con FAQs (${hubFaqUnits[0].has_content} con content_es)`);

  // ─── 7. SAMPLE DE UNA FAQ REAL ──────────────────────────────
  console.log("\n## 7. Ejemplo de FAQ real de content_es\n");
  const faqSample = await db.$queryRawUnsafe<any[]>(`
    SELECT p.development_name, p.content_es->'faq' as faq, s.domain
    FROM public.properties p
    JOIN public.sources s ON s.id = p.source_id
    WHERE p.status IN ('review','published')
      AND p.content_es->'faq' IS NOT NULL
      AND jsonb_typeof(p.content_es->'faq') = 'array'
      AND jsonb_array_length(p.content_es->'faq') > 0
    LIMIT 1
  `);
  if (faqSample.length > 0) {
    const f = faqSample[0];
    console.log(`  Desarrollo: "${f.development_name}" (${f.domain})`);
    console.log(`  FAQs (${f.faq.length}):`);
    for (const q of f.faq.slice(0, 3)) {
      console.log(`    Q: ${String(q.question || q.pregunta || "?").substring(0, 120)}`);
      console.log(`    A: ${String(q.answer || q.respuesta || "?").substring(0, 120)}`);
      console.log();
    }
  }

  // ─── 8. PROPYTE_FAQS_ZONA TABLE ──────────────────────────────
  console.log("## 8. Tabla Propyte_faqs_zona\n");
  const faqZona = await db.$queryRawUnsafe<any[]>(`
    SELECT COUNT(*) as cnt FROM real_estate_hub."Propyte_faqs_zona"
  `);
  console.log(`  Rows: ${faqZona[0].cnt}`);

  await closeDb();
}

main().catch((e) => { console.error(e); process.exit(1); });
