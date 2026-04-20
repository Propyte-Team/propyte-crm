/**
 * Aplica RLS a las tablas que quedaron sin policies tras apply-rls-policies.ts:
 *
 * - investment_analytics.airdna_metrics, development_financials, rental_comparables
 *   → RLS ON + policy SELECT público (anon + authenticated)
 *
 * - real_estate_hub.Propyte_sync_log, Propyte_robot_runs, Propyte_zoho_sync_log
 *   → RLS ON, SIN policies para anon/auth (solo service_role via bypass)
 *
 * - real_estate_hub.Propyte_faqs_zona
 *   → RLS ON + policy SELECT WHERE ext_publicado=true
 *
 * Uso: npx tsx scripts/apply-rls-remaining.ts [--dry-run]
 */
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";

config();

const DRY_RUN = process.argv.includes("--dry-run");
const pwd = process.env.SUPABASE_DB_PASSWORD!;
const URL = `postgresql://postgres.oaijxdpevakashxshhvm:${encodeURIComponent(pwd)}@aws-1-us-east-1.pooler.supabase.com:5432/postgres`;
const db = new PrismaClient({ datasourceUrl: URL });

const statements: Array<{ label: string; sql: string }> = [];

// investment_analytics: RLS ON + policy público SELECT
for (const t of ["airdna_metrics", "development_financials", "rental_comparables"]) {
  statements.push({ label: `ENABLE RLS investment_analytics.${t}`, sql: `ALTER TABLE investment_analytics."${t}" ENABLE ROW LEVEL SECURITY` });
  statements.push({ label: `DROP POLICY IF EXISTS select_public_${t}`, sql: `DROP POLICY IF EXISTS "select_public" ON investment_analytics."${t}"` });
  statements.push({
    label: `CREATE POLICY select_public on investment_analytics.${t}`,
    sql: `CREATE POLICY "select_public" ON investment_analytics."${t}"
          FOR SELECT TO anon, authenticated USING (true)`,
  });
}

// Logs internos: RLS ON, sin policies (service_role bypass)
for (const t of ["Propyte_sync_log", "Propyte_robot_runs", "Propyte_zoho_sync_log"]) {
  statements.push({ label: `ENABLE RLS real_estate_hub.${t}`, sql: `ALTER TABLE real_estate_hub."${t}" ENABLE ROW LEVEL SECURITY` });
  // No policies → anon/auth bloqueados por defecto, service_role bypass
}

// FAQs zona: RLS ON + policy público condicionado
statements.push({ label: `ENABLE RLS real_estate_hub.Propyte_faqs_zona`, sql: `ALTER TABLE real_estate_hub."Propyte_faqs_zona" ENABLE ROW LEVEL SECURITY` });
statements.push({ label: `DROP POLICY IF EXISTS select_published on faqs_zona`, sql: `DROP POLICY IF EXISTS "select_published" ON real_estate_hub."Propyte_faqs_zona"` });
statements.push({
  label: `CREATE POLICY select_published on Propyte_faqs_zona`,
  sql: `CREATE POLICY "select_published" ON real_estate_hub."Propyte_faqs_zona"
        FOR SELECT TO anon, authenticated
        USING (ext_publicado = true AND deleted_at IS NULL)`,
});

async function main() {
  console.log(`${DRY_RUN ? "[DRY RUN] " : ""}Aplicando RLS a ${statements.length} statements`);

  for (const s of statements) {
    process.stdout.write(`  ${s.label}: `);
    if (DRY_RUN) { console.log("[dry]"); continue; }
    try {
      await db.$executeRawUnsafe(s.sql);
      console.log("OK");
    } catch (e: any) {
      console.log(`FAIL ${e.message?.split("\n")[0]}`);
    }
  }

  // Verificación
  console.log("\nVerificación:");
  const rls = await db.$queryRawUnsafe<Array<{ schema: string; tbl: string; rls: boolean; policies: bigint }>>(`
    SELECT n.nspname AS schema, c.relname AS tbl, c.relrowsecurity AS rls,
           (SELECT COUNT(*)::bigint FROM pg_policies p WHERE p.schemaname = n.nspname AND p.tablename = c.relname) AS policies
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r' AND c.relname IN (
      'airdna_metrics','development_financials','rental_comparables',
      'Propyte_sync_log','Propyte_robot_runs','Propyte_zoho_sync_log','Propyte_faqs_zona'
    )
    ORDER BY n.nspname, c.relname
  `);
  rls.forEach(r => console.log(`  [${r.schema}] ${r.tbl.padEnd(25)} RLS=${r.rls}  policies=${r.policies}`));

  await db.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
