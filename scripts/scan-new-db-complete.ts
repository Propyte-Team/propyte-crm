/**
 * Scan COMPLETO de la nueva DB — todo lo que Felipe (o cualquiera) haya creado.
 *
 * Lista: schemas, tablas, vistas, funciones, triggers, FKs, indexes, RLS,
 * buckets, auth users, extensions.
 */

import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";

config();

const NEW_REF = "oaijxdpevakashxshhvm";
const password = process.env.SUPABASE_DB_PASSWORD!;
const NEW_URL = `postgresql://postgres.${NEW_REF}:${encodeURIComponent(password)}@aws-1-us-east-1.pooler.supabase.com:5432/postgres`;

const STOCK_SCHEMAS = [
  "auth", "extensions", "graphql", "graphql_public", "pgbouncer", "realtime",
  "storage", "vault", "pg_catalog", "information_schema", "supabase_functions",
  "supabase_migrations", "net", "cron", "pgsodium", "pgsodium_masks",
];

async function main() {
  const db = new PrismaClient({ datasources: { db: { url: NEW_URL } } });
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  try {
    console.log("\n============================================");
    console.log("SCAN COMPLETO — NUEVA DB (oaijxdpevakashxshhvm)");
    console.log("============================================\n");

    // === SCHEMAS ===
    console.log("## SCHEMAS (no-stock)\n");
    const schemas = (await db.$queryRawUnsafe(
      `SELECT schema_name FROM information_schema.schemata
       WHERE schema_name NOT LIKE 'pg_%' AND schema_name != 'information_schema'
       ORDER BY schema_name`
    )) as Array<{ schema_name: string }>;
    const customSchemas = schemas.filter((s) => !STOCK_SCHEMAS.includes(s.schema_name));
    for (const s of customSchemas) console.log(`  - ${s.schema_name}`);

    // === TABLAS POR SCHEMA (custom) ===
    for (const s of customSchemas) {
      console.log(`\n## TABLAS en schema "${s.schema_name}"\n`);
      const tables = (await db.$queryRawUnsafe(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = $1 AND table_type = 'BASE TABLE'
         ORDER BY table_name`,
        s.schema_name
      )) as Array<{ table_name: string }>;

      for (const t of tables) {
        const cols = (await db.$queryRawUnsafe(
          `SELECT column_name, data_type, is_nullable, column_default
           FROM information_schema.columns
           WHERE table_schema = $1 AND table_name = $2
           ORDER BY ordinal_position`,
          s.schema_name,
          t.table_name
        )) as Array<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>;

        let count: string | number = "?";
        try {
          const r = (await db.$queryRawUnsafe(
            `SELECT COUNT(*)::text as n FROM "${s.schema_name}"."${t.table_name}"`
          )) as Array<{ n: string }>;
          count = r[0].n;
        } catch {
          count = "err";
        }

        console.log(`### ${s.schema_name}.${t.table_name} (${cols.length} cols, ${count} rows)`);
        for (const c of cols) {
          const nn = c.is_nullable === "NO" ? " NOT NULL" : "";
          const def = c.column_default ? ` DEFAULT ${c.column_default}` : "";
          console.log(`  - ${c.column_name}: ${c.data_type}${nn}${def}`);
        }

        // FKs de esta tabla
        const fks = (await db.$queryRawUnsafe(
          `SELECT
             kcu.column_name,
             ccu.table_schema AS ref_schema,
             ccu.table_name AS ref_table,
             ccu.column_name AS ref_column,
             tc.constraint_name
           FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu
             ON tc.constraint_name = kcu.constraint_name
             AND tc.table_schema = kcu.table_schema
           JOIN information_schema.constraint_column_usage ccu
             ON ccu.constraint_name = tc.constraint_name
             AND ccu.table_schema = tc.table_schema
           WHERE tc.constraint_type = 'FOREIGN KEY'
             AND tc.table_schema = $1
             AND tc.table_name = $2`,
          s.schema_name,
          t.table_name
        )) as Array<{ column_name: string; ref_schema: string; ref_table: string; ref_column: string; constraint_name: string }>;
        if (fks.length > 0) {
          console.log("  FKs:");
          for (const fk of fks)
            console.log(`    ${fk.column_name} -> ${fk.ref_schema}.${fk.ref_table}.${fk.ref_column}`);
        }
        console.log();
      }

      // Vistas
      const views = (await db.$queryRawUnsafe(
        `SELECT table_name FROM information_schema.views
         WHERE table_schema = $1 ORDER BY table_name`,
        s.schema_name
      )) as Array<{ table_name: string }>;
      if (views.length > 0) {
        console.log(`### VISTAS en ${s.schema_name}:`);
        for (const v of views) console.log(`  - ${v.table_name}`);
        console.log();
      }

      // Funciones
      const funcs = (await db.$queryRawUnsafe(
        `SELECT routine_name, routine_type, data_type as return_type
         FROM information_schema.routines
         WHERE routine_schema = $1
         ORDER BY routine_name`,
        s.schema_name
      )) as Array<{ routine_name: string; routine_type: string; return_type: string }>;
      if (funcs.length > 0) {
        console.log(`### FUNCIONES en ${s.schema_name}:`);
        for (const f of funcs) console.log(`  - ${f.routine_name} (${f.routine_type}) returns ${f.return_type}`);
        console.log();
      }

      // Triggers
      const trigs = (await db.$queryRawUnsafe(
        `SELECT trigger_name, event_object_table, event_manipulation, action_timing
         FROM information_schema.triggers
         WHERE trigger_schema = $1
         ORDER BY event_object_table, trigger_name`,
        s.schema_name
      )) as Array<{ trigger_name: string; event_object_table: string; event_manipulation: string; action_timing: string }>;
      if (trigs.length > 0) {
        console.log(`### TRIGGERS en ${s.schema_name}:`);
        for (const tr of trigs)
          console.log(`  - ${tr.event_object_table}.${tr.trigger_name} (${tr.action_timing} ${tr.event_manipulation})`);
        console.log();
      }
    }

    // === EXTENSIONS ===
    console.log("## EXTENSIONS instaladas\n");
    const exts = (await db.$queryRawUnsafe(
      `SELECT extname, extversion FROM pg_extension ORDER BY extname`
    )) as Array<{ extname: string; extversion: string }>;
    for (const e of exts) console.log(`  - ${e.extname} v${e.extversion}`);

    // === RLS POLICIES ===
    console.log("\n## RLS POLICIES (en schemas custom)\n");
    const policies = (await db.$queryRawUnsafe(
      `SELECT schemaname, tablename, policyname, cmd, qual
       FROM pg_policies
       WHERE schemaname NOT IN ('auth','storage','realtime','pgsodium','vault')
       ORDER BY schemaname, tablename, policyname`
    )) as Array<{ schemaname: string; tablename: string; policyname: string; cmd: string; qual: string }>;
    if (policies.length === 0) {
      console.log("  (ninguna)");
    } else {
      for (const p of policies) {
        console.log(`  - ${p.schemaname}.${p.tablename}: ${p.policyname} (${p.cmd})`);
      }
    }

    // === STORAGE BUCKETS ===
    console.log("\n## STORAGE BUCKETS\n");
    const { data: buckets } = await sb.storage.listBuckets();
    for (const b of buckets ?? []) {
      console.log(`  - ${b.name} (public=${b.public}, created=${b.created_at})`);
    }

    // === AUTH USERS ===
    console.log("\n## AUTH USERS (count)\n");
    try {
      const u = (await db.$queryRawUnsafe(
        `SELECT COUNT(*)::text as n FROM auth.users`
      )) as Array<{ n: string }>;
      console.log(`  Total usuarios registrados: ${u[0].n}`);

      const recent = (await db.$queryRawUnsafe(
        `SELECT email, created_at FROM auth.users ORDER BY created_at DESC LIMIT 5`
      )) as Array<{ email: string; created_at: Date }>;
      for (const r of recent) console.log(`    - ${r.email} (${r.created_at})`);
    } catch (e: any) {
      console.log(`  err: ${e.message.split("\n")[0]}`);
    }

    // === EDGE FUNCTIONS (via supabase_functions schema) ===
    console.log("\n## EDGE FUNCTIONS / DB Webhooks\n");
    try {
      const hooks = (await db.$queryRawUnsafe(
        `SELECT hook_table_id::text, hook_name, hook_function_id::text, created_at
         FROM supabase_functions.hooks ORDER BY created_at DESC LIMIT 20`
      )) as Array<any>;
      if (hooks.length === 0) console.log("  (ninguna)");
      else for (const h of hooks) console.log(`  - ${h.hook_name}`);
    } catch {
      console.log("  (schema supabase_functions no disponible o vacio)");
    }

    console.log("\n============================================");
    console.log("FIN DEL SCAN");
    console.log("============================================\n");
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error("Error fatal:", e);
  process.exit(1);
});
