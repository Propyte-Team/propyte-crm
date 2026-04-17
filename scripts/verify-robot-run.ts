import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
config();

const URL = `postgresql://postgres.oaijxdpevakashxshhvm:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD!)}@aws-1-us-east-1.pooler.supabase.com:5432/postgres`;

async function main() {
  const db = new PrismaClient({ datasources: { db: { url: URL } } });
  try {
    console.log("## Robot_runs recientes\n");
    const runs = (await db.$queryRawUnsafe(
      `SELECT robot_name, status, duration_ms, outputs, host, started_at
       FROM real_estate_hub."Propyte_robot_runs"
       ORDER BY started_at DESC LIMIT 5`
    )) as any[];
    for (const r of runs) {
      console.log(`  [${r.started_at.toISOString().slice(0,19)}] ${r.robot_name} ${r.status} (${r.duration_ms}ms) on ${r.host}`);
      console.log(`    outputs: ${JSON.stringify(r.outputs)}`);
    }

    console.log("\n## Desarrollos creados por robot-01\n");
    const desarrollos = (await db.$queryRawUnsafe(
      `SELECT id::text, nombre_desarrollo, id_desarrollador::text,
              ext_precio_min_mxn, ext_precio_max_mxn,
              estado, municipio, colonia,
              ext_source_url, ext_scraper_first_seen_at,
              jsonb_array_length(COALESCE(ext_content_es->'faq', '[]'::jsonb)) as faq_count,
              amenidad_alberca_comunitaria, amenidad_gym, amenidad_coworking
       FROM real_estate_hub."Propyte_desarrollos"
       WHERE ext_detection_source = 'robot-01-classifier'
       ORDER BY created_at DESC LIMIT 10`
    )) as any[];
    console.log(`Total: ${desarrollos.length}`);
    for (const d of desarrollos) {
      console.log(`\n  ${d.nombre_desarrollo} (id: ${d.id.slice(0,8)}...)`);
      console.log(`    desarrollador: ${d.id_desarrollador?.slice(0,8) ?? 'null'}`);
      console.log(`    precio: $${d.ext_precio_min_mxn} - $${d.ext_precio_max_mxn} MXN`);
      console.log(`    ubicacion: ${d.estado} / ${d.municipio} / ${d.colonia ?? '(no col)'}`);
      console.log(`    source: ${d.ext_source_url?.slice(0,60) ?? 'null'}`);
      console.log(`    FAQs: ${d.faq_count}`);
      console.log(`    amenities: alberca=${d.amenidad_alberca_comunitaria} gym=${d.amenidad_gym} coworking=${d.amenidad_coworking}`);
    }

    console.log("\n## Unidades creadas\n");
    const unidades = (await db.$queryRawUnsafe(
      `SELECT id::text, titulo_unidad, id_desarrollo::text,
              precio_mxn, precio_usd, recamaras, banos_completos, superficie_total_m2,
              ext_source_url, estado_unidad,
              jsonb_array_length(COALESCE(ext_content_es->'faq', '[]'::jsonb)) as faq_count
       FROM real_estate_hub."Propyte_unidades"
       WHERE ext_detection_source = 'robot-01-classifier'
       ORDER BY created_at DESC LIMIT 10`
    )) as any[];
    console.log(`Total: ${unidades.length}`);
    for (const u of unidades) {
      console.log(`\n  ${u.titulo_unidad ?? '(no title)'} (id: ${u.id.slice(0,8)}...)`);
      console.log(`    desarrollo: ${u.id_desarrollo?.slice(0,8) ?? 'null'}`);
      console.log(`    precio: ${u.precio_mxn} MXN / ${u.precio_usd ?? '-'} USD`);
      console.log(`    ${u.recamaras}br ${u.banos_completos}ba ${u.superficie_total_m2}m2`);
      console.log(`    source: ${u.ext_source_url?.slice(0,60) ?? 'null'}`);
      console.log(`    status: ${u.estado_unidad}`);
      console.log(`    FAQs: ${u.faq_count}`);
    }

    console.log("\n## Desarrolladores creados\n");
    const devs = (await db.$queryRawUnsafe(
      `SELECT id::text, nombre_desarrollador, created_at
       FROM real_estate_hub."Propyte_desarrolladores"
       ORDER BY created_at DESC LIMIT 10`
    )) as any[];
    console.log(`Total: ${devs.length}`);
    for (const d of devs) {
      console.log(`  ${d.nombre_desarrollador} (${d.id.slice(0,8)}...)`);
    }
  } finally {
    await db.$disconnect();
  }
}
main();
