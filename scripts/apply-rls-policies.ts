/**
 * Aplica RLS policies a real_estate_hub en la NUEVA DB.
 *
 * 1. Agrega columnas ext_publicado / ext_destacado donde falten
 * 2. Habilita RLS en todas las tablas custom
 * 3. Crea policies segun reglas acordadas:
 *    - Zoho tablas: denied a anon/authenticated (solo service_role)
 *    - Desarrollos/Unidades/Desarrolladores: anon SELECT donde ext_publicado=true
 *    - Historial/Resenas: anon SELECT publico
 * 4. Vistas security_invoker + GRANT SELECT a anon/authenticated
 *
 * Uso: npx tsx scripts/apply-rls-policies.ts [--dry-run]
 */

import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";

config();

const NEW_REF = "oaijxdpevakashxshhvm";
const password = process.env.SUPABASE_DB_PASSWORD!;
const NEW_URL = `postgresql://postgres.${NEW_REF}:${encodeURIComponent(password)}@aws-1-us-east-1.pooler.supabase.com:5432/postgres`;

const DRY_RUN = process.argv.includes("--dry-run");

const statements: Array<{ label: string; sql: string }> = [];

// === 1. Agregar columnas faltantes ===
statements.push({
  label: "ALTER Propyte_desarrolladores + ext_publicado + ext_destacado",
  sql: `ALTER TABLE real_estate_hub."Propyte_desarrolladores"
        ADD COLUMN IF NOT EXISTS ext_publicado boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS ext_destacado boolean NOT NULL DEFAULT false`,
});

statements.push({
  label: "ALTER Propyte_historial_precios + ext_publicado + ext_destacado",
  sql: `ALTER TABLE real_estate_hub."Propyte_historial_precios"
        ADD COLUMN IF NOT EXISTS ext_publicado boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS ext_destacado boolean NOT NULL DEFAULT false`,
});

statements.push({
  label: "ALTER Propyte_resenas + ext_publicado + ext_destacado",
  sql: `ALTER TABLE real_estate_hub."Propyte_resenas"
        ADD COLUMN IF NOT EXISTS ext_publicado boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS ext_destacado boolean NOT NULL DEFAULT false`,
});

statements.push({
  label: "ALTER Propyte_unidades + ext_destacado",
  sql: `ALTER TABLE real_estate_hub."Propyte_unidades"
        ADD COLUMN IF NOT EXISTS ext_destacado boolean NOT NULL DEFAULT false`,
});

// === 2. Habilitar RLS en todas las tablas ===
const TABLES = [
  "Propyte_desarrolladores",
  "Propyte_desarrollos",
  "Propyte_unidades",
  "Propyte_historial_precios",
  "Propyte_resenas",
  "Propyte_zoho_leads",
  "Propyte_zoho_accounts",
  "Propyte_zoho_contacts",
  "Propyte_zoho_deals",
  "Propyte_zoho_id_map",
];

for (const t of TABLES) {
  statements.push({
    label: `ENABLE RLS ${t}`,
    sql: `ALTER TABLE real_estate_hub."${t}" ENABLE ROW LEVEL SECURITY`,
  });
  // Drop cualquier policy previa con mismo nombre (idempotencia)
  statements.push({
    label: `DROP existing policies ${t}`,
    sql: `DO $$
          DECLARE p record;
          BEGIN
            FOR p IN SELECT policyname FROM pg_policies
                     WHERE schemaname='real_estate_hub' AND tablename='${t}'
            LOOP
              EXECUTE format('DROP POLICY IF EXISTS %I ON real_estate_hub.%I', p.policyname, '${t}');
            END LOOP;
          END $$`,
  });
}

// === 3. Policies ===

// Desarrolladores, Desarrollos, Unidades: publico solo si ext_publicado y no borrado
for (const t of ["Propyte_desarrolladores", "Propyte_desarrollos", "Propyte_unidades"]) {
  statements.push({
    label: `POLICY select_published on ${t}`,
    sql: `CREATE POLICY "select_published" ON real_estate_hub."${t}"
          FOR SELECT TO anon, authenticated
          USING (ext_publicado = true AND deleted_at IS NULL)`,
  });
}

// Historial de precios: publico si ext_publicado
statements.push({
  label: `POLICY select_published on Propyte_historial_precios`,
  sql: `CREATE POLICY "select_published" ON real_estate_hub."Propyte_historial_precios"
        FOR SELECT TO anon, authenticated
        USING (ext_publicado = true)`,
});

// Resenas: publico si verificada + ext_publicado
statements.push({
  label: `POLICY select_verified_published on Propyte_resenas`,
  sql: `CREATE POLICY "select_verified_published" ON real_estate_hub."Propyte_resenas"
        FOR SELECT TO anon, authenticated
        USING (verificada = true AND ext_publicado = true)`,
});

// Zoho tablas: NO policies creadas = anon/authenticated bloqueados
// (service_role bypasses RLS automaticamente)

// === 4. Vistas: security_invoker + GRANT ===
for (const v of ["v_developers", "v_developments", "v_units"]) {
  statements.push({
    label: `ALTER VIEW ${v} security_invoker`,
    sql: `ALTER VIEW real_estate_hub."${v}" SET (security_invoker = true)`,
  });
  statements.push({
    label: `GRANT SELECT on ${v}`,
    sql: `GRANT SELECT ON real_estate_hub."${v}" TO anon, authenticated`,
  });
}

// === Ejecutar ===
async function main() {
  const db = new PrismaClient({ datasources: { db: { url: NEW_URL } } });

  console.log(`\n=== RLS Policies ${DRY_RUN ? "(DRY RUN)" : "(EJECUTANDO)"} ===\n`);

  if (DRY_RUN) {
    const fs = await import("fs");
    const outputPath = "./scripts/generated-rls-policies.sql";
    const fullSql = statements.map((s) => `-- === ${s.label} ===\n${s.sql};\n`).join("\n");
    fs.writeFileSync(outputPath, fullSql);
    console.log(`[DRY RUN] SQL guardado en ${outputPath}`);
    console.log(`Total statements: ${statements.length}`);
    await db.$disconnect();
    return;
  }

  try {
    for (const stmt of statements) {
      process.stdout.write(`  ${stmt.label}: `);
      try {
        await db.$executeRawUnsafe(stmt.sql);
        console.log("OK");
      } catch (e: any) {
        console.log(`[FAIL] ${e.message.split("\n")[0]}`);
        throw e;
      }
    }

    // Verificacion
    console.log("\n=== Verificacion ===\n");
    const policies = (await db.$queryRawUnsafe(
      `SELECT tablename, policyname, cmd, roles::text
       FROM pg_policies WHERE schemaname = 'real_estate_hub'
       ORDER BY tablename, policyname`
    )) as Array<{ tablename: string; policyname: string; cmd: string; roles: string }>;
    console.log(`Policies activas (${policies.length}):`);
    for (const p of policies)
      console.log(`  - ${p.tablename}: ${p.policyname} (${p.cmd} for ${p.roles})`);

    const rlsTables = (await db.$queryRawUnsafe(
      `SELECT c.relname, c.relrowsecurity as rls
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'real_estate_hub' AND c.relkind = 'r'
       ORDER BY c.relname`
    )) as Array<{ relname: string; rls: boolean }>;
    console.log(`\nRLS status por tabla:`);
    for (const t of rlsTables) console.log(`  - ${t.relname}: RLS=${t.rls}`);

    console.log("\n[SUCCESS]\n");
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error("\nError fatal:", e.message);
  process.exit(1);
});
