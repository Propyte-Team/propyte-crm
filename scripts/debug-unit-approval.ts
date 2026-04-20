import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
config();

const P = process.env.SUPABASE_DB_PASSWORD!;
const URL = `postgresql://postgres.oaijxdpevakashxshhvm:${encodeURIComponent(P)}@aws-1-us-east-1.pooler.supabase.com:5432/postgres`;
const db = new PrismaClient({ datasources: { db: { url: URL } } });

async function q(sql: string) {
  return db.$queryRawUnsafe(sql) as Promise<any[]>;
}

async function main() {
  console.log("DEBUG: Por qué 0 unidades pasan el filtro\n");

  const total = await q(`SELECT COUNT(*)::int as n FROM real_estate_hub."Propyte_unidades" WHERE deleted_at IS NULL`);
  console.log(`1. Total unidades (no deleted): ${total[0].n}`);

  const notApproved = await q(`SELECT COUNT(*)::int as n FROM real_estate_hub."Propyte_unidades" WHERE deleted_at IS NULL AND approved_at IS NULL`);
  console.log(`2. Sin approved_at (candidatas): ${notApproved[0].n}`);

  const withDev = await q(`SELECT COUNT(*)::int as n FROM real_estate_hub."Propyte_unidades" WHERE deleted_at IS NULL AND approved_at IS NULL AND id_desarrollo IS NOT NULL`);
  console.log(`3. + con id_desarrollo: ${withDev[0].n}`);

  const withPrice = await q(`SELECT COUNT(*)::int as n FROM real_estate_hub."Propyte_unidades" WHERE deleted_at IS NULL AND approved_at IS NULL AND id_desarrollo IS NOT NULL AND (precio_mxn > 0 OR precio_usd > 0)`);
  console.log(`4. + con precio > 0: ${withPrice[0].n}`);

  // Check what developments are approved
  const approvedDevs = await q(`SELECT COUNT(*)::int as n FROM real_estate_hub."Propyte_desarrollos" WHERE approved_at IS NOT NULL AND LOWER(zoho_pipeline_status) IN ('aprobado','listo')`);
  console.log(`\n5. Desarrollos aprobados: ${approvedDevs[0].n}`);

  const approvedPublished = await q(`SELECT COUNT(*)::int as n FROM real_estate_hub."Propyte_desarrollos" WHERE approved_at IS NOT NULL AND LOWER(zoho_pipeline_status) IN ('aprobado','listo') AND ext_publicado = true`);
  console.log(`6. + con ext_publicado=true: ${approvedPublished[0].n}`);

  // Check if units' id_desarrollo matches any approved desarrollo
  const unitsMatchingApproved = await q(`
    SELECT COUNT(*)::int as n
    FROM real_estate_hub."Propyte_unidades" u
    WHERE u.deleted_at IS NULL
      AND u.id_desarrollo IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM real_estate_hub."Propyte_desarrollos" d
        WHERE d.id = u.id_desarrollo
          AND d.approved_at IS NOT NULL
      )
  `);
  console.log(`7. Unidades con desarrollo aprobado (any): ${unitsMatchingApproved[0].n}`);

  // Sample: show some unit id_desarrollo vs desarrollo ids
  const sampleUnits = await q(`
    SELECT u.id_desarrollo, u.precio_mxn, u.precio_usd
    FROM real_estate_hub."Propyte_unidades" u
    WHERE u.deleted_at IS NULL AND u.id_desarrollo IS NOT NULL
    LIMIT 5
  `);
  console.log(`\n8. Muestra de unidades con id_desarrollo:`);
  for (const u of sampleUnits) {
    console.log(`   dev_id=${u.id_desarrollo}, precio_mxn=${u.precio_mxn}, precio_usd=${u.precio_usd}`);
  }

  const sampleDevs = await q(`
    SELECT id, nombre_desarrollo, approved_at, zoho_pipeline_status, ext_publicado
    FROM real_estate_hub."Propyte_desarrollos"
    WHERE approved_at IS NOT NULL
    LIMIT 5
  `);
  console.log(`\n9. Muestra de desarrollos aprobados:`);
  for (const d of sampleDevs) {
    console.log(`   id=${d.id}, name=${d.nombre_desarrollo}, status=${d.zoho_pipeline_status}, publicado=${d.ext_publicado}`);
  }

  await db.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
