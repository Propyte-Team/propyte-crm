/**
 * Aprueba unidades que pertenecen a desarrollos ya aprobados y tienen precio.
 * npx tsx scripts/approve-linked-units.ts
 */
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
config();

const P = process.env.SUPABASE_DB_PASSWORD!;
const URL = `postgresql://postgres.oaijxdpevakashxshhvm:${encodeURIComponent(P)}@aws-1-us-east-1.pooler.supabase.com:5432/postgres`;
const db = new PrismaClient({ datasources: { db: { url: URL } } });

async function main() {
  console.log("Aprobando unidades vinculadas a desarrollos aprobados...\n");

  // Before
  const before = (await db.$queryRawUnsafe(
    `SELECT COUNT(*)::int as n FROM real_estate_hub."Propyte_unidades" WHERE approved_at IS NOT NULL`
  )) as any[];
  console.log(`Antes: ${before[0].n} unidades aprobadas`);

  // Approve
  // No filtra por ext_publicado — WP ya filtra por published en el sync
  const updated = await db.$executeRawUnsafe(`
    UPDATE real_estate_hub."Propyte_unidades" u
    SET approved_at = NOW(),
        approved_by = 'auto:approve-linked-units',
        zoho_pipeline_status = 'Aprobado',
        updated_at = NOW()
    WHERE u.deleted_at IS NULL
      AND u.approved_at IS NULL
      AND u.id_desarrollo IS NOT NULL
      AND (u.precio_mxn > 0 OR u.precio_usd > 0)
      AND EXISTS (
        SELECT 1 FROM real_estate_hub."Propyte_desarrollos" d
        WHERE d.id = u.id_desarrollo
          AND d.approved_at IS NOT NULL
          AND LOWER(d.zoho_pipeline_status) IN ('aprobado', 'listo')
      )
  `);
  console.log(`Actualizadas: ${updated}`);

  // After
  const after = (await db.$queryRawUnsafe(
    `SELECT COUNT(*)::int as n FROM real_estate_hub."Propyte_unidades" WHERE approved_at IS NOT NULL`
  )) as any[];
  console.log(`Después: ${after[0].n} unidades aprobadas`);

  // Breakdown
  const linked = (await db.$queryRawUnsafe(`
    SELECT COUNT(*)::int as n FROM real_estate_hub."Propyte_unidades"
    WHERE approved_at IS NOT NULL
      AND LOWER(zoho_pipeline_status) IN ('aprobado','listo')
      AND id_desarrollo IS NOT NULL
      AND (precio_mxn > 0 OR precio_usd > 0)
  `)) as any[];
  console.log(`Con precio + desarrollo padre: ${linked[0].n}`);

  await db.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
