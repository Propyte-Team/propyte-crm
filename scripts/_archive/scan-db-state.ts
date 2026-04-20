/**
 * 1. Borra el schema Borrador en la NUEVA DB
 * 2. Lista las tablas existentes en public de la NUEVA DB
 * 3. Escanea real_estate_hub de la VIEJA DB (estructura, sin datos)
 *
 * Uso: npx tsx scripts/scan-db-state.ts
 */

import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";

config();

const NEW_REF = "oaijxdpevakashxshhvm";
const OLD_REF = "yjbrynsykkycozeybykj";

const password = process.env.SUPABASE_DB_PASSWORD;
if (!password) {
  console.error("Falta SUPABASE_DB_PASSWORD en .env");
  process.exit(1);
}

const NEW_URL = `postgresql://postgres.${NEW_REF}:${encodeURIComponent(password)}@aws-1-us-east-1.pooler.supabase.com:5432/postgres`;
const OLD_URL = process.env.DATABASE_URL!; // ya apunta al pooler viejo

if (!OLD_URL.includes(OLD_REF)) {
  console.error(`DATABASE_URL no apunta a ${OLD_REF}, apunta a:`, OLD_URL.slice(0, 80));
  process.exit(1);
}

async function main() {
  const newDb = new PrismaClient({ datasources: { db: { url: NEW_URL } } });
  const oldDb = new PrismaClient({ datasources: { db: { url: OLD_URL } } });

  try {
    // ===== 1. Borrar Borrador en NUEVA =====
    console.log("\n=== 1. Borrando schema Borrador en NUEVA DB ===\n");
    try {
      await newDb.$executeRawUnsafe('DROP SCHEMA IF EXISTS "Borrador" CASCADE');
      console.log("[OK] Schema Borrador eliminado");
    } catch (e: any) {
      console.log(`[FAIL] ${e.message}`);
    }

    // Verificar
    const remaining = (await newDb.$queryRawUnsafe(
      "SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('pg_catalog','information_schema','pg_toast') ORDER BY schema_name"
    )) as Array<{ schema_name: string }>;
    console.log(`Schemas restantes en NUEVA: ${remaining.map((r) => r.schema_name).join(", ")}`);

    // ===== 2. Listar tablas en public de NUEVA =====
    console.log("\n=== 2. Tablas en public de NUEVA DB ===\n");
    const newPublicTables = (await newDb.$queryRawUnsafe(
      `SELECT table_name,
              (SELECT COUNT(*) FROM information_schema.columns c
               WHERE c.table_schema = 'public' AND c.table_name = t.table_name) as cols
       FROM information_schema.tables t
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       ORDER BY table_name`
    )) as Array<{ table_name: string; cols: bigint }>;

    if (newPublicTables.length === 0) {
      console.log("(vacio — no hay tablas custom en public)");
    } else {
      console.log(`Encontradas ${newPublicTables.length} tablas:`);
      for (const t of newPublicTables) {
        console.log(`  - ${t.table_name} (${t.cols} cols)`);
      }
    }

    // ===== 3. Scan real_estate_hub de VIEJA =====
    console.log("\n=== 3. Inventario real_estate_hub en VIEJA DB ===\n");

    // 3a. Tablas
    const oldTables = (await oldDb.$queryRawUnsafe(
      `SELECT table_name,
              (SELECT COUNT(*) FROM information_schema.columns c
               WHERE c.table_schema = 'real_estate_hub' AND c.table_name = t.table_name) as cols
       FROM information_schema.tables t
       WHERE table_schema = 'real_estate_hub' AND table_type = 'BASE TABLE'
       ORDER BY table_name`
    )) as Array<{ table_name: string; cols: bigint }>;

    console.log(`TABLAS (${oldTables.length}):`);
    for (const t of oldTables) {
      // Contar filas
      let count = "?";
      try {
        const c = (await oldDb.$queryRawUnsafe(
          `SELECT COUNT(*)::text as n FROM real_estate_hub."${t.table_name}"`
        )) as Array<{ n: string }>;
        count = c[0].n;
      } catch {
        count = "err";
      }
      console.log(`  - ${t.table_name} (${t.cols} cols, ${count} rows)`);
    }

    // 3b. Vistas
    const oldViews = (await oldDb.$queryRawUnsafe(
      `SELECT table_name FROM information_schema.views
       WHERE table_schema = 'real_estate_hub' ORDER BY table_name`
    )) as Array<{ table_name: string }>;
    console.log(`\nVISTAS (${oldViews.length}):`);
    for (const v of oldViews) console.log(`  - ${v.table_name}`);

    // 3c. Funciones
    const oldFuncs = (await oldDb.$queryRawUnsafe(
      `SELECT routine_name FROM information_schema.routines
       WHERE routine_schema = 'real_estate_hub' AND routine_type = 'FUNCTION'
       ORDER BY routine_name`
    )) as Array<{ routine_name: string }>;
    console.log(`\nFUNCIONES (${oldFuncs.length}):`);
    for (const f of oldFuncs) console.log(`  - ${f.routine_name}`);

    // 3d. Triggers (en tablas del schema)
    const oldTriggers = (await oldDb.$queryRawUnsafe(
      `SELECT trigger_name, event_object_table
       FROM information_schema.triggers
       WHERE trigger_schema = 'real_estate_hub'
       ORDER BY event_object_table, trigger_name`
    )) as Array<{ trigger_name: string; event_object_table: string }>;
    console.log(`\nTRIGGERS (${oldTriggers.length}):`);
    for (const tr of oldTriggers)
      console.log(`  - ${tr.event_object_table}.${tr.trigger_name}`);

    // ===== 4. Otros schemas custom en VIEJA (por si hay algo mas) =====
    console.log("\n=== 4. Otros schemas en VIEJA (no stock Supabase) ===\n");
    const STOCK = [
      "auth",
      "extensions",
      "graphql",
      "graphql_public",
      "pgbouncer",
      "realtime",
      "storage",
      "vault",
      "pg_catalog",
      "information_schema",
      "pg_toast",
      "public",
      "real_estate_hub",
      "supabase_functions",
      "supabase_migrations",
      "net",
      "cron",
    ];
    const allSchemas = (await oldDb.$queryRawUnsafe(
      "SELECT schema_name FROM information_schema.schemata ORDER BY schema_name"
    )) as Array<{ schema_name: string }>;
    const custom = allSchemas.filter((s) => !STOCK.includes(s.schema_name));
    if (custom.length === 0) {
      console.log("(ninguno — solo real_estate_hub, public y stock)");
    } else {
      for (const s of custom) {
        const tables = (await oldDb.$queryRawUnsafe(
          `SELECT COUNT(*)::text as n FROM information_schema.tables WHERE table_schema = '${s.schema_name}'`
        )) as Array<{ n: string }>;
        console.log(`  - ${s.schema_name} (${tables[0].n} tablas)`);
      }
    }

    console.log("\n=== FIN ===\n");
  } finally {
    await newDb.$disconnect();
    await oldDb.$disconnect();
  }
}

main().catch((e) => {
  console.error("Error fatal:", e);
  process.exit(1);
});
