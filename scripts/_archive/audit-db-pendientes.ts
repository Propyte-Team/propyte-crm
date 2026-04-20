/**
 * Auditoría de estado de pendientes de DB.
 *
 * Verifica en la NUEVA Supabase:
 * - Tablas Propyte_zoho_* existen (001_zoho_sync_setup.sql)
 * - Propyte_zoho_sync_log existe
 * - Propyte_historial_precios / Propyte_resenas rows
 * - Propyte_faqs_zona rows
 * - RLS habilitado en qué tablas
 * - Conteo de leads, contacts, deals, accounts Zoho
 * - Conteo de desarrollos, unidades, desarrolladores
 *
 * Uso: npx tsx scripts/audit-db-pendientes.ts
 */

import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";

config();

const NEW_REF = "oaijxdpevakashxshhvm";
const password = process.env.SUPABASE_DB_PASSWORD!;
const NEW_URL = `postgresql://postgres.${NEW_REF}:${encodeURIComponent(password)}@aws-1-us-east-1.pooler.supabase.com:5432/postgres`;

const prisma = new PrismaClient({ datasourceUrl: NEW_URL });

async function main() {
  console.log("=== AUDITORIA DB PENDIENTES ===\n");

  // 1. Tablas Propyte_zoho_*
  console.log("1. TABLAS PROPYTE_ZOHO_*");
  const zohoTables = await prisma.$queryRawUnsafe<Array<{ table_name: string }>>(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'real_estate_hub'
      AND table_name LIKE 'Propyte_zoho%'
    ORDER BY table_name
  `);
  zohoTables.forEach(t => console.log(`  - ${t.table_name}`));
  console.log(`  Total: ${zohoTables.length}\n`);

  // 2. Conteos Zoho
  console.log("2. CONTEOS ZOHO");
  for (const tbl of ["Propyte_zoho_leads", "Propyte_zoho_contacts", "Propyte_zoho_deals", "Propyte_zoho_accounts", "Propyte_zoho_id_map", "Propyte_zoho_sync_log"]) {
    try {
      const r = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT COUNT(*)::bigint AS count FROM real_estate_hub."${tbl}"`);
      console.log(`  ${tbl}: ${r[0].count}`);
    } catch (e: any) {
      console.log(`  ${tbl}: ERROR ${e.message?.slice(0, 80)}`);
    }
  }
  console.log("");

  // 3. Columnas agregadas a Propyte_desarrollos (001_zoho_sync_setup)
  console.log("3. COLUMNAS ZOHO EN Propyte_desarrollos");
  const desCols = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'real_estate_hub'
      AND table_name = 'Propyte_desarrollos'
      AND column_name IN ('zoho_pipeline_status','zoho_record_id','zoho_last_synced_at','zoho_sync_error','approved_at','approved_by')
    ORDER BY column_name
  `);
  desCols.forEach(c => console.log(`  + ${c.column_name}`));
  console.log(`  Total: ${desCols.length}/6 esperadas\n`);

  // 4. historial_precios / resenas
  console.log("4. HISTORIAL_PRECIOS + RESENAS (rows)");
  for (const tbl of ["Propyte_historial_precios", "Propyte_resenas", "Propyte_faqs_zona"]) {
    try {
      const r = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT COUNT(*)::bigint AS count FROM real_estate_hub."${tbl}"`);
      console.log(`  ${tbl}: ${r[0].count}`);
    } catch (e: any) {
      console.log(`  ${tbl}: ERROR ${e.message?.slice(0, 80)}`);
    }
  }
  console.log("");

  // 5. RLS habilitado
  console.log("5. RLS STATUS EN real_estate_hub");
  const rls = await prisma.$queryRawUnsafe<Array<{ tablename: string; rowsecurity: boolean }>>(`
    SELECT tablename, rowsecurity
    FROM pg_tables
    WHERE schemaname = 'real_estate_hub'
    ORDER BY tablename
  `);
  rls.forEach(r => console.log(`  ${r.rowsecurity ? "ON " : "OFF"} ${r.tablename}`));
  console.log("");

  // 6. Policies
  const pols = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(`
    SELECT COUNT(*)::bigint AS count
    FROM pg_policies
    WHERE schemaname = 'real_estate_hub'
  `);
  console.log(`6. POLICIES en real_estate_hub: ${pols[0].count}\n`);

  // 7. Conteos hub
  console.log("7. CONTEOS real_estate_hub (datos nuestros)");
  for (const tbl of ["Propyte_desarrolladores", "Propyte_desarrollos", "Propyte_unidades"]) {
    try {
      const r = await prisma.$queryRawUnsafe<Array<{ count: bigint; approved: bigint }>>(`
        SELECT COUNT(*)::bigint AS count,
               COUNT(*) FILTER (WHERE ext_publicado = true)::bigint AS approved
        FROM real_estate_hub."${tbl}"
      `);
      console.log(`  ${tbl}: ${r[0].count} total / ${r[0].approved} aprobados`);
    } catch (e: any) {
      console.log(`  ${tbl}: ERROR ${e.message?.slice(0, 80)}`);
    }
  }
  console.log("");

  // 8. DB vieja — ver cuántos Propyte_historial_precios y Propyte_resenas tiene
  console.log("8. DB VIEJA (yjbrynsykkycozeybykj) — historial_precios/resenas disponibles");
  const oldPassword = process.env.OLD_SUPABASE_DB_PASSWORD ?? process.env.SUPABASE_DB_PASSWORD_OLD;
  if (oldPassword) {
    const OLD_REF = "yjbrynsykkycozeybykj";
    const OLD_URL = `postgresql://postgres.${OLD_REF}:${encodeURIComponent(oldPassword)}@aws-1-us-east-1.pooler.supabase.com:5432/postgres`;
    const oldPrisma = new PrismaClient({ datasourceUrl: OLD_URL });
    try {
      for (const tbl of ["Propyte_historial_precios", "Propyte_resenas"]) {
        try {
          const r = await oldPrisma.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT COUNT(*)::bigint AS count FROM real_estate_hub."${tbl}"`);
          console.log(`  ${tbl}: ${r[0].count} rows disponibles para migrar`);
        } catch (e: any) {
          console.log(`  ${tbl}: ERROR ${e.message?.slice(0, 80)}`);
        }
      }
    } finally {
      await oldPrisma.$disconnect();
    }
  } else {
    console.log("  [SKIP] No hay password de DB vieja en env");
  }

  await prisma.$disconnect();
  console.log("\n=== FIN AUDITORIA ===");
}

main().catch(e => { console.error(e); process.exit(1); });
