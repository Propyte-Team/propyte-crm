/**
 * Diagnostica que puede estar causando que PostgREST no pueda construir
 * el schema cache. Verifica:
 * - Vistas validas (pueden ejecutarse)
 * - Permisos del rol authenticator
 * - Objetos invalidos
 */

import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";

config();

const NEW_URL = `postgresql://postgres.oaijxdpevakashxshhvm:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD!)}@aws-1-us-east-1.pooler.supabase.com:5432/postgres`;

async function main() {
  const db = new PrismaClient({ datasources: { db: { url: NEW_URL } } });
  try {
    console.log("\n=== Diagnostico PostgREST ===\n");

    // 1. Vistas - intentar SELECT real
    console.log("--- 1. SELECT de cada vista ---");
    for (const v of ["v_developers", "v_developments", "v_units"]) {
      try {
        const r = (await db.$queryRawUnsafe(
          `SELECT COUNT(*)::text as n FROM real_estate_hub."${v}" LIMIT 1`
        )) as any;
        console.log(`  ${v}: OK (${r[0].n} rows)`);
      } catch (e: any) {
        console.log(`  ${v}: FAIL - ${e.message.split("\n")[0]}`);
      }
    }

    // 2. Verificar que authenticator tenga USAGE
    console.log("\n--- 2. Permisos del rol authenticator ---");
    const authPerms = (await db.$queryRawUnsafe(
      `SELECT r.rolname, n.nspname, has_schema_privilege(r.rolname, n.nspname, 'USAGE') as can_use
       FROM pg_roles r, pg_namespace n
       WHERE r.rolname IN ('authenticator', 'anon', 'authenticated', 'service_role')
         AND n.nspname IN ('public', 'real_estate_hub')
       ORDER BY r.rolname, n.nspname`
    )) as any[];
    for (const p of authPerms) console.log(`  ${p.rolname} USAGE on ${p.nspname}: ${p.can_use}`);

    // 3. Revisar si hay objetos con dependencias rotas
    console.log("\n--- 3. Objetos con posibles problemas ---");
    try {
      const brokenViews = (await db.$queryRawUnsafe(
        `SELECT table_schema, table_name
         FROM information_schema.views
         WHERE table_schema IN ('public', 'real_estate_hub')`
      )) as any[];
      for (const v of brokenViews) {
        try {
          await db.$queryRawUnsafe(`SELECT * FROM "${v.table_schema}"."${v.table_name}" LIMIT 0`);
          console.log(`  ${v.table_schema}.${v.table_name}: valida`);
        } catch (e: any) {
          console.log(`  ${v.table_schema}.${v.table_name}: ROTA - ${e.message.split("\n")[0]}`);
        }
      }
    } catch (e: any) {
      console.log("  err listing views:", e.message);
    }

    // 4. Forzar reload schema cache
    console.log("\n--- 4. NOTIFY pgrst reload schema ---");
    await db.$executeRawUnsafe(`NOTIFY pgrst, 'reload schema'`);
    console.log("  Signal enviado");

    // 5. Ver si el search_path del authenticator incluye los schemas
    console.log("\n--- 5. Config PostgREST (db_schemas) ---");
    try {
      const dbSchemas = (await db.$queryRawUnsafe(
        `SELECT name, setting FROM pg_settings WHERE name LIKE 'pgrst%'`
      )) as any[];
      for (const s of dbSchemas) console.log(`  ${s.name} = ${s.setting}`);
    } catch (e: any) {
      console.log("  (no pgrst settings visible)");
    }

    // 6. Contar total de tablas+vistas por schema (para ver si hay algo masivo)
    console.log("\n--- 6. Tamanyo de cada schema ---");
    const sizes = (await db.$queryRawUnsafe(
      `SELECT schemaname, COUNT(*) as objs
       FROM pg_tables
       WHERE schemaname IN ('public', 'real_estate_hub')
       GROUP BY schemaname`
    )) as any[];
    for (const s of sizes) console.log(`  ${s.schemaname}: ${s.objs} tablas`);

    // 7. Verificar que todas las tablas tengan columnas validas (nada corrupto)
    console.log("\n--- 7. Tablas de real_estate_hub con issues ---");
    const tables = (await db.$queryRawUnsafe(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'real_estate_hub' AND table_type = 'BASE TABLE'`
    )) as Array<{ table_name: string }>;
    for (const t of tables) {
      try {
        await db.$queryRawUnsafe(
          `SELECT * FROM real_estate_hub."${t.table_name}" LIMIT 0`
        );
      } catch (e: any) {
        console.log(`  ${t.table_name}: PROBLEMA - ${e.message.split("\n")[0]}`);
      }
    }
    console.log("  (si no hay output, todas las tablas son queryables)");

  } finally {
    await db.$disconnect();
  }
}

main();
