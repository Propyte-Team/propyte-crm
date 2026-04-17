import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
config();
const P = process.env.SUPABASE_DB_PASSWORD!;
const URL = `postgresql://postgres.oaijxdpevakashxshhvm:${encodeURIComponent(P)}@aws-1-us-east-1.pooler.supabase.com:5432/postgres`;
const db = new PrismaClient({ datasources: { db: { url: URL } } });

async function main() {
  console.log("VERIFICACIÓN: Columnas TEXT pobladas desde JSONB\n");

  // Desarrollos
  const devs = (await db.$queryRawUnsafe(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(ext_descripcion_es)::int AS desc_es,
      COUNT(ext_descripcion_corta_es)::int AS desc_corta_es,
      COUNT(ext_meta_title_desarrollo)::int AS meta_title,
      COUNT(ext_meta_description_desarrollo)::int AS meta_desc,
      COUNT(ext_content_es)::int AS jsonb_raw
    FROM real_estate_hub."Propyte_desarrollos"
    WHERE deleted_at IS NULL
  `)) as any[];
  const d = devs[0];
  console.log("## Propyte_desarrollos");
  console.log(`  Total:                    ${d.total}`);
  console.log(`  ext_descripcion_es:       ${d.desc_es}`);
  console.log(`  ext_descripcion_corta_es: ${d.desc_corta_es}`);
  console.log(`  ext_meta_title:           ${d.meta_title}`);
  console.log(`  ext_meta_description:     ${d.meta_desc}`);
  console.log(`  ext_content_es (JSONB):   ${d.jsonb_raw}`);

  // Sample
  const sample = (await db.$queryRawUnsafe(`
    SELECT nombre_desarrollo, ext_descripcion_es, ext_meta_title_desarrollo, ext_descripcion_corta_es
    FROM real_estate_hub."Propyte_desarrollos"
    WHERE ext_descripcion_es IS NOT NULL AND deleted_at IS NULL
    LIMIT 2
  `)) as any[];
  console.log("\n  Muestra:");
  for (const s of sample) {
    console.log(`  --- ${s.nombre_desarrollo} ---`);
    console.log(`    meta_title:  ${(s.ext_meta_title_desarrollo || "NULL").slice(0, 70)}`);
    console.log(`    desc_es:     ${(s.ext_descripcion_es || "NULL").slice(0, 100)}...`);
    console.log(`    desc_corta:  ${(s.ext_descripcion_corta_es || "NULL").slice(0, 80)}`);
  }

  // Unidades
  const units = (await db.$queryRawUnsafe(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(descripcion_larga_unidad)::int AS desc_larga,
      COUNT(descripcion_corta_unidad)::int AS desc_corta,
      COUNT(meta_title_unidad)::int AS meta_title,
      COUNT(meta_description_unidad)::int AS meta_desc,
      COUNT(titulo_unidad)::int AS titulo
    FROM real_estate_hub."Propyte_unidades"
    WHERE deleted_at IS NULL
  `)) as any[];
  const u = units[0];
  console.log("\n## Propyte_unidades");
  console.log(`  Total:                    ${u.total}`);
  console.log(`  titulo_unidad:            ${u.titulo}`);
  console.log(`  descripcion_larga:        ${u.desc_larga}`);
  console.log(`  descripcion_corta:        ${u.desc_corta}`);
  console.log(`  meta_title_unidad:        ${u.meta_title}`);
  console.log(`  meta_description_unidad:  ${u.meta_desc}`);

  const sampleU = (await db.$queryRawUnsafe(`
    SELECT titulo_unidad, descripcion_larga_unidad, meta_title_unidad
    FROM real_estate_hub."Propyte_unidades"
    WHERE descripcion_larga_unidad IS NOT NULL AND deleted_at IS NULL
    LIMIT 2
  `)) as any[];
  console.log("\n  Muestra:");
  for (const s of sampleU) {
    console.log(`  --- ${(s.titulo_unidad || "sin titulo").slice(0, 60)} ---`);
    console.log(`    meta_title:  ${(s.meta_title_unidad || "NULL").slice(0, 70)}`);
    console.log(`    desc_larga:  ${(s.descripcion_larga_unidad || "NULL").slice(0, 100)}...`);
  }

  await db.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
