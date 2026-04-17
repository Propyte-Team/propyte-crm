import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
config();

const URL = `postgresql://postgres.oaijxdpevakashxshhvm:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD!)}@aws-1-us-east-1.pooler.supabase.com:5432/postgres`;

async function main() {
  const db = new PrismaClient({ datasources: { db: { url: URL } } });
  try {
    console.log("## Unidades con precio USD convertido a MXN — top 10 por precio\n");

    const rows = (await db.$queryRawUnsafe(
      `SELECT u.precio_usd, u.precio_mxn,
              CASE WHEN u.precio_usd > 0 THEN ROUND((u.precio_mxn / u.precio_usd)::numeric, 3) ELSE NULL END as tasa_implicita,
              u.titulo_unidad, d.nombre_desarrollo
       FROM real_estate_hub."Propyte_unidades" u
       LEFT JOIN real_estate_hub."Propyte_desarrollos" d ON d.id = u.id_desarrollo
       WHERE u.ext_detection_source = 'robot-01-classifier'
         AND u.precio_usd IS NOT NULL
         AND u.precio_usd > 0
       ORDER BY u.precio_mxn DESC
       LIMIT 10`
    )) as any[];

    for (const r of rows) {
      console.log(`  $${r.precio_usd} USD -> $${r.precio_mxn} MXN (tasa: ${r.tasa_implicita})`);
      console.log(`    ${r.nombre_desarrollo ?? "(suelta)"}: ${r.titulo_unidad ?? "(sin titulo)"}`);
    }

    console.log("\n## Resumen de tasas en uso (deberia ser ~17.347 tras re-run con Banxico)\n");
    const stats = (await db.$queryRawUnsafe(
      `SELECT ROUND(AVG(precio_mxn / precio_usd)::numeric, 3) as tasa_avg,
              MIN(ROUND((precio_mxn / precio_usd)::numeric, 3)) as tasa_min,
              MAX(ROUND((precio_mxn / precio_usd)::numeric, 3)) as tasa_max,
              COUNT(*)::int as n_usd_units
       FROM real_estate_hub."Propyte_unidades"
       WHERE precio_usd IS NOT NULL AND precio_usd > 0 AND precio_mxn IS NOT NULL`
    )) as any[];
    console.log(`  tasa_avg: ${stats[0].tasa_avg}, tasa_min: ${stats[0].tasa_min}, tasa_max: ${stats[0].tasa_max}`);
    console.log(`  unidades con precio USD: ${stats[0].n_usd_units}`);
  } finally {
    await db.$disconnect();
  }
}
main();
