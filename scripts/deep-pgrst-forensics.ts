/**
 * Forensics nuevos para PGRST002 - cosas no probadas antes:
 * 1. Role memberships (authenticator debe poder SET ROLE)
 * 2. Event triggers de PostgREST (pgrst_ddl_watch / pgrst_drop_watch)
 * 3. search_path del authenticator
 * 4. Extensiones instaladas (pg_graphql, pg_net, etc)
 * 5. Timing de introspeccion - simular query pesada de pg_catalog que hace PostgREST
 * 6. Vistas con columnas rotas (pg_attribute vs definicion)
 * 7. RLS policies que referencian objetos inexistentes
 * 8. Publications / subscriptions (replicacion)
 * 9. Columnas con tipos custom que PostgREST no puede mappear
 */

import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";

config();

const NEW_URL = `postgresql://postgres.oaijxdpevakashxshhvm:${encodeURIComponent(
  process.env.SUPABASE_DB_PASSWORD!
)}@aws-1-us-east-1.pooler.supabase.com:5432/postgres`;

async function main() {
  const db = new PrismaClient({ datasources: { db: { url: NEW_URL } } });
  try {
    console.log("\n=== FORENSICS PROFUNDO PGRST002 ===\n");

    // 1. Role memberships - authenticator debe poder GRANT a anon/authenticated/service_role
    console.log("--- 1. Role memberships (authenticator -> anon/authenticated/service_role) ---");
    const memberships = (await db.$queryRawUnsafe(`
      SELECT
        r.rolname AS role,
        m.rolname AS member_of,
        pg_has_role(r.rolname, m.rolname, 'MEMBER') AS can_set_role
      FROM pg_roles r
      CROSS JOIN pg_roles m
      WHERE r.rolname = 'authenticator'
        AND m.rolname IN ('anon', 'authenticated', 'service_role', 'postgres')
      ORDER BY m.rolname
    `)) as any[];
    for (const m of memberships) {
      const flag = m.can_set_role ? "OK" : "MISSING";
      console.log(`  ${flag} authenticator -> ${m.member_of}: ${m.can_set_role}`);
    }

    // 2. search_path del authenticator
    console.log("\n--- 2. search_path authenticator ---");
    const searchPath = (await db.$queryRawUnsafe(`
      SELECT rolconfig FROM pg_roles WHERE rolname = 'authenticator'
    `)) as any[];
    console.log("  rolconfig:", JSON.stringify(searchPath[0]?.rolconfig));

    // 3. Event triggers PostgREST
    console.log("\n--- 3. Event triggers (pgrst_*) ---");
    const evtTriggers = (await db.$queryRawUnsafe(`
      SELECT evtname, evtevent, evtenabled, evtfoid::regproc::text as function
      FROM pg_event_trigger
      WHERE evtname LIKE 'pgrst%' OR evtname LIKE '%pgrst%'
    `)) as any[];
    if (evtTriggers.length === 0) console.log("  (ninguno encontrado)");
    for (const et of evtTriggers) {
      console.log(`  ${et.evtname} (${et.evtevent}) enabled=${et.evtenabled} fn=${et.function}`);
    }

    // 4. Extensiones en Supabase
    console.log("\n--- 4. Extensiones activas ---");
    const exts = (await db.$queryRawUnsafe(`
      SELECT extname, extversion FROM pg_extension ORDER BY extname
    `)) as any[];
    for (const e of exts) console.log(`  ${e.extname} v${e.extversion}`);

    // 5. Timing de introspeccion - esta es LA query que mata a PostgREST.
    // Si este query tarda mucho o falla, encontramos la causa.
    console.log("\n--- 5. Test introspeccion pg_catalog ---");
    const t0 = Date.now();
    try {
      const cols = (await db.$queryRawUnsafe(`
        SELECT COUNT(*)::text as n FROM information_schema.columns
        WHERE table_schema IN ('public', 'real_estate_hub', 'storage', 'graphql', 'graphql_public', 'pgsodium', 'vault', 'auth')
      `)) as any[];
      console.log(`  cols count: ${cols[0].n} en ${Date.now() - t0}ms`);
    } catch (e: any) {
      console.log(`  FAIL: ${e.message}`);
    }

    // 6. Tipos custom o columnas extranyas
    console.log("\n--- 6. Columnas con tipos raros en real_estate_hub ---");
    const weirdCols = (await db.$queryRawUnsafe(`
      SELECT c.table_name, c.column_name, c.data_type, c.udt_name
      FROM information_schema.columns c
      WHERE c.table_schema = 'real_estate_hub'
        AND (c.data_type = 'USER-DEFINED' OR c.udt_name LIKE '\\_%' OR c.data_type = 'ARRAY')
      ORDER BY c.table_name, c.ordinal_position
      LIMIT 30
    `)) as any[];
    for (const w of weirdCols) {
      console.log(`  ${w.table_name}.${w.column_name}: ${w.data_type} (${w.udt_name})`);
    }

    // 7. RLS policies activas
    console.log("\n--- 7. RLS policies activas ---");
    const policies = (await db.$queryRawUnsafe(`
      SELECT schemaname, tablename, policyname, permissive, roles::text as roles, cmd
      FROM pg_policies
      WHERE schemaname IN ('public', 'real_estate_hub')
      ORDER BY schemaname, tablename
    `)) as any[];
    console.log(`  Total policies: ${policies.length}`);
    for (const p of policies) {
      console.log(`  ${p.schemaname}.${p.tablename} ${p.policyname} [${p.cmd}] roles=${p.roles}`);
    }

    // 8. Definicion actual de las vistas (por si referencian cols que ya no existen)
    console.log("\n--- 8. Definicion de vistas en real_estate_hub ---");
    const viewDefs = (await db.$queryRawUnsafe(`
      SELECT table_name, view_definition
      FROM information_schema.views
      WHERE table_schema = 'real_estate_hub'
    `)) as any[];
    for (const v of viewDefs) {
      const firstLine = (v.view_definition || "").split("\n")[0].slice(0, 150);
      console.log(`  ${v.table_name}: ${firstLine}...`);
    }

    // 9. Simular la query de introspeccion REAL de PostgREST (simplificada)
    // Es la query que build_schema_cache corre - busca tablas, cols, pks, fks, fns, etc.
    console.log("\n--- 9. Query tipo PostgREST schema cache (simulada) ---");
    const t1 = Date.now();
    try {
      const introspec = (await db.$queryRawUnsafe(`
        SELECT
          n.nspname as schema_name,
          c.relname as name,
          c.relkind as kind,
          COUNT(a.attname) as col_count
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
        WHERE n.nspname IN ('public', 'real_estate_hub', 'storage', 'graphql_public')
          AND c.relkind IN ('r', 'v', 'm', 'f', 'p')
        GROUP BY n.nspname, c.relname, c.relkind
        ORDER BY n.nspname, c.relname
      `)) as any[];
      console.log(`  ${introspec.length} relations en ${Date.now() - t1}ms`);
      for (const i of introspec.slice(0, 20)) {
        console.log(`    ${i.schema_name}.${i.name} (${i.kind}) ${i.col_count} cols`);
      }
      if (introspec.length > 20) console.log(`    ... +${introspec.length - 20} mas`);
    } catch (e: any) {
      console.log(`  FAIL: ${e.message}`);
    }

    // 10. Publications (replicacion) - si hay publication rota, bloquea schema cache
    console.log("\n--- 10. Publications ---");
    const pubs = (await db.$queryRawUnsafe(`
      SELECT pubname, puballtables, pubinsert, pubupdate FROM pg_publication
    `)) as any[];
    if (pubs.length === 0) console.log("  (ninguna)");
    for (const p of pubs) console.log(`  ${p.pubname} all=${p.puballtables}`);

    // 11. Functions publicas (pueden tener bugs que rompen introspection)
    console.log("\n--- 11. Funciones en schemas expuestos ---");
    const fns = (await db.$queryRawUnsafe(`
      SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname IN ('public', 'real_estate_hub', 'graphql_public')
      LIMIT 30
    `)) as any[];
    console.log(`  Total fns listadas: ${fns.length}`);
    for (const f of fns) console.log(`    ${f.nspname}.${f.proname}(${f.args})`);

    // 12. Verificar columnas reales vs lo que la vista espera
    console.log("\n--- 12. Columnas de Propyte_desarrollos (verificar ext_publicado/destacado) ---");
    const cols = (await db.$queryRawUnsafe(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'real_estate_hub' AND table_name = 'Propyte_desarrollos'
        AND column_name LIKE 'ext_%'
    `)) as any[];
    for (const c of cols) console.log(`  ${c.column_name} (${c.data_type})`);

  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
