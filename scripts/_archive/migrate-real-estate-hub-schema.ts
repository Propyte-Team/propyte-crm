/**
 * Migra estructura del schema real_estate_hub de la VIEJA Supabase a la NUEVA.
 *
 * Solo estructura, SIN datos.
 * Solo las tablas aprobadas + las 3 vistas.
 * Sin funciones, sin triggers (se construyen despues desde cero).
 *
 * Uso: npx tsx scripts/migrate-real-estate-hub-schema.ts [--dry-run]
 */

import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";

config();

const NEW_REF = "oaijxdpevakashxshhvm";
const OLD_REF = "yjbrynsykkycozeybykj";

const password = process.env.SUPABASE_DB_PASSWORD!;
const NEW_URL = `postgresql://postgres.${NEW_REF}:${encodeURIComponent(password)}@aws-1-us-east-1.pooler.supabase.com:5432/postgres`;
const OLD_URL = process.env.DATABASE_URL!;

if (!OLD_URL.includes(OLD_REF)) {
  console.error("DATABASE_URL no apunta al Supabase viejo");
  process.exit(1);
}

const TABLES_TO_COPY = [
  "Propyte_desarrolladores",
  "Propyte_desarrollos",
  "Propyte_unidades",
  "Propyte_zoho_leads",
  "Propyte_zoho_accounts",
  "Propyte_zoho_contacts",
  "Propyte_zoho_deals",
  "Propyte_zoho_id_map",
  "Propyte_historial_precios",
  "Propyte_resenas",
];

const VIEWS_TO_COPY = ["v_developers", "v_developments", "v_units"];

const DRY_RUN = process.argv.includes("--dry-run");

interface ColDef {
  column_name: string;
  data_type: string;
  not_null: boolean;
  default_value: string | null;
}

async function extractTableDDL(old: PrismaClient, tableName: string): Promise<string> {
  // 1. Columnas con tipos exactos
  const cols = (await old.$queryRawUnsafe(
    `SELECT
       a.attname as column_name,
       pg_catalog.format_type(a.atttypid, a.atttypmod) as data_type,
       a.attnotnull as not_null,
       pg_get_expr(ad.adbin, ad.adrelid) as default_value
     FROM pg_attribute a
     JOIN pg_class c ON c.oid = a.attrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     LEFT JOIN pg_attrdef ad ON ad.adrelid = c.oid AND ad.adnum = a.attnum
     WHERE n.nspname = 'real_estate_hub'
       AND c.relname = $1
       AND a.attnum > 0
       AND NOT a.attisdropped
     ORDER BY a.attnum`,
    tableName
  )) as ColDef[];

  // 2. Primary key
  const pk = (await old.$queryRawUnsafe(
    `SELECT a.attname
     FROM pg_index i
     JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
     JOIN pg_class c ON c.oid = i.indrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE i.indisprimary
       AND n.nspname = 'real_estate_hub'
       AND c.relname = $1
     ORDER BY array_position(i.indkey, a.attnum)`,
    tableName
  )) as Array<{ attname: string }>;

  // 3. Unique constraints (no-PK)
  const uniques = (await old.$queryRawUnsafe(
    `SELECT conname,
            array_agg(a.attname ORDER BY array_position(con.conkey, a.attnum)) as cols
     FROM pg_constraint con
     JOIN pg_class c ON c.oid = con.conrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(con.conkey)
     WHERE con.contype = 'u'
       AND n.nspname = 'real_estate_hub'
       AND c.relname = $1
     GROUP BY conname`,
    tableName
  )) as Array<{ conname: string; cols: string[] }>;

  // 4. Check constraints
  const checks = (await old.$queryRawUnsafe(
    `SELECT conname, pg_get_constraintdef(con.oid) as def
     FROM pg_constraint con
     JOIN pg_class c ON c.oid = con.conrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE con.contype = 'c'
       AND n.nspname = 'real_estate_hub'
       AND c.relname = $1`,
    tableName
  )) as Array<{ conname: string; def: string }>;

  // Build CREATE TABLE
  const colDefs = cols.map((c) => {
    let def = `  "${c.column_name}" ${c.data_type}`;
    if (c.default_value) def += ` DEFAULT ${c.default_value}`;
    if (c.not_null) def += " NOT NULL";
    return def;
  });

  if (pk.length > 0) {
    const pkCols = pk.map((p) => `"${p.attname}"`).join(", ");
    colDefs.push(`  CONSTRAINT "${tableName}_pkey" PRIMARY KEY (${pkCols})`);
  }

  for (const u of uniques) {
    const uCols = u.cols.map((c) => `"${c}"`).join(", ");
    colDefs.push(`  CONSTRAINT "${u.conname}" UNIQUE (${uCols})`);
  }

  for (const ck of checks) {
    colDefs.push(`  CONSTRAINT "${ck.conname}" ${ck.def}`);
  }

  return `CREATE TABLE real_estate_hub."${tableName}" (\n${colDefs.join(",\n")}\n);`;
}

async function extractViewDDL(old: PrismaClient, viewName: string): Promise<string> {
  const r = (await old.$queryRawUnsafe(
    `SELECT pg_get_viewdef('real_estate_hub."${viewName}"'::regclass, true) as def`
  )) as Array<{ def: string }>;
  return `CREATE OR REPLACE VIEW real_estate_hub."${viewName}" AS\n${r[0].def}`;
}

async function main() {
  const oldDb = new PrismaClient({ datasources: { db: { url: OLD_URL } } });
  const newDb = new PrismaClient({ datasources: { db: { url: NEW_URL } } });

  const allStatements: Array<{ label: string; sql: string }> = [];

  try {
    console.log(`\n=== Migracion de schema real_estate_hub ${DRY_RUN ? "(DRY RUN)" : "(EJECUTANDO)"} ===\n`);

    // 0. Crear schema
    allStatements.push({
      label: "CREATE SCHEMA real_estate_hub",
      sql: "CREATE SCHEMA IF NOT EXISTS real_estate_hub;",
    });

    // 1. Extraer DDL de tablas
    console.log("Extrayendo DDL de tablas...");
    for (const t of TABLES_TO_COPY) {
      process.stdout.write(`  ${t}: `);
      const ddl = await extractTableDDL(oldDb, t);
      allStatements.push({ label: `TABLE ${t}`, sql: ddl });
      console.log(`OK (${ddl.split("\n").length} lineas)`);
    }

    // 2. Extraer DDL de vistas
    console.log("\nExtrayendo DDL de vistas...");
    for (const v of VIEWS_TO_COPY) {
      process.stdout.write(`  ${v}: `);
      const ddl = await extractViewDDL(oldDb, v);
      allStatements.push({ label: `VIEW ${v}`, sql: ddl });
      console.log("OK");
    }

    // 3. Guardar SQL a archivo (para revision)
    const fs = await import("fs");
    const outputPath = "./scripts/generated-real-estate-hub.sql";
    const fullSql = allStatements.map((s) => `-- === ${s.label} ===\n${s.sql}\n`).join("\n");
    fs.writeFileSync(outputPath, fullSql);
    console.log(`\nSQL generado guardado en: ${outputPath}`);

    if (DRY_RUN) {
      console.log("\n[DRY RUN] No se ejecuto nada. Revisa el archivo SQL.");
      return;
    }

    // 4. Ejecutar en nueva DB
    console.log("\n=== Ejecutando en NUEVA DB ===\n");
    for (const stmt of allStatements) {
      process.stdout.write(`  ${stmt.label}: `);
      try {
        await newDb.$executeRawUnsafe(stmt.sql);
        console.log("OK");
      } catch (e: any) {
        console.log(`[FAIL] ${e.message.split("\n")[0]}`);
        console.log(`    SQL: ${stmt.sql.slice(0, 200)}...`);
        throw e;
      }
    }

    // 5. Verificar
    console.log("\n=== Verificacion ===\n");
    const newTables = (await newDb.$queryRawUnsafe(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'real_estate_hub' AND table_type = 'BASE TABLE'
       ORDER BY table_name`
    )) as Array<{ table_name: string }>;
    console.log(`Tablas en nueva DB (${newTables.length}):`);
    for (const t of newTables) console.log(`  - ${t.table_name}`);

    const newViews = (await newDb.$queryRawUnsafe(
      `SELECT table_name FROM information_schema.views
       WHERE table_schema = 'real_estate_hub' ORDER BY table_name`
    )) as Array<{ table_name: string }>;
    console.log(`\nVistas en nueva DB (${newViews.length}):`);
    for (const v of newViews) console.log(`  - ${v.table_name}`);

    console.log("\n[SUCCESS] Migracion completa\n");
  } finally {
    await oldDb.$disconnect();
    await newDb.$disconnect();
  }
}

main().catch((e) => {
  console.error("\nError fatal:", e.message);
  process.exit(1);
});
