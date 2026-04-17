/**
 * Aplica migraciones SQL de infraestructura de robots sobre la nueva Supabase.
 *
 * Las migraciones estan en scripts/sql/robot_infra_*.sql y son idempotentes
 * (usan IF NOT EXISTS / CREATE OR REPLACE / ADD COLUMN IF NOT EXISTS).
 *
 * Uso:
 *   npx tsx scripts/apply-robot-migrations.ts           # aplica
 *   npx tsx scripts/apply-robot-migrations.ts --dry-run # solo imprime SQL
 *   npx tsx scripts/apply-robot-migrations.ts --verify  # solo verifica estado
 */

import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

config();

const NEW_REF = "oaijxdpevakashxshhvm";
const PASSWORD = process.env.SUPABASE_DB_PASSWORD;

if (!PASSWORD) {
  console.error("[FATAL] SUPABASE_DB_PASSWORD no esta definido en .env");
  process.exit(1);
}

const URL = `postgresql://postgres.${NEW_REF}:${encodeURIComponent(
  PASSWORD
)}@aws-1-us-east-1.pooler.supabase.com:5432/postgres`;

const DRY_RUN = process.argv.includes("--dry-run");
const VERIFY_ONLY = process.argv.includes("--verify");

const SQL_DIR = join(__dirname, "sql");

async function verifyState(db: PrismaClient) {
  console.log("\n## Estado actual de real_estate_hub\n");

  const extCols = (await db.$queryRawUnsafe(
    `SELECT column_name, data_type
     FROM information_schema.columns
     WHERE table_schema = 'real_estate_hub'
       AND table_name IN ('Propyte_unidades', 'Propyte_desarrollos')
       AND column_name LIKE 'ext_content%'
     ORDER BY table_name, column_name`
  )) as any[];
  console.log(`  Columnas ext_content_* encontradas: ${extCols.length}`);
  for (const c of extCols) console.log(`    - ${c.column_name}: ${c.data_type}`);

  const robotRuns = (await db.$queryRawUnsafe(
    `SELECT COUNT(*)::int as n FROM information_schema.tables
     WHERE table_schema = 'real_estate_hub' AND table_name = 'Propyte_robot_runs'`
  )) as any[];
  console.log(`  Tabla Propyte_robot_runs: ${robotRuns[0].n === 1 ? "existe" : "FALTA"}`);

  const faqsZona = (await db.$queryRawUnsafe(
    `SELECT COUNT(*)::int as n FROM information_schema.tables
     WHERE table_schema = 'real_estate_hub' AND table_name = 'Propyte_faqs_zona'`
  )) as any[];
  console.log(`  Tabla Propyte_faqs_zona: ${faqsZona[0].n === 1 ? "existe" : "FALTA"}`);

  const indices = (await db.$queryRawUnsafe(
    `SELECT indexname FROM pg_indexes
     WHERE schemaname = 'real_estate_hub'
       AND indexname IN (
         'idx_unidades_ext_source_url',
         'idx_desarrollos_nombre_desarrollador',
         'idx_desarrolladores_nombre_lower',
         'idx_robot_runs_name_started',
         'idx_faqs_zona_ciudad_orden'
       )
     ORDER BY indexname`
  )) as any[];
  console.log(`  Indices para upsert + observabilidad: ${indices.length}/5`);
  for (const i of indices) console.log(`    - ${i.indexname}`);
}

/**
 * Splittea un SQL file en statements individuales.
 * Asume:
 *  - cada statement termina en `;` en final de linea
 *  - los comentarios son line-comments con doble-dash
 *  - no hay strings multi-linea con `;` embebidos
 */
function splitStatements(sql: string): string[] {
  // Remueve comentarios de linea
  const noComments = sql
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("--");
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join("\n");

  // Split por ; y filtra vacios/whitespace
  return noComments
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function applyMigration(db: PrismaClient, filename: string, sql: string) {
  const statements = splitStatements(sql);
  console.log(`\n## Aplicando ${filename}`);
  console.log(`   ${statements.length} statements`);

  if (DRY_RUN) {
    for (let i = 0; i < statements.length; i++) {
      console.log(`\n--- statement ${i + 1}/${statements.length} ---`);
      console.log(statements[i].slice(0, 300) + (statements[i].length > 300 ? "..." : ""));
    }
    return;
  }

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    try {
      await db.$executeRawUnsafe(stmt);
      const preview = stmt.replace(/\s+/g, " ").slice(0, 80);
      console.log(`   [${i + 1}/${statements.length}] OK: ${preview}...`);
    } catch (err: any) {
      console.error(`\n   [${i + 1}/${statements.length}] FAILED`);
      console.error(`   Statement: ${stmt.slice(0, 200)}`);
      console.error(`   Error: ${err.message}`);
      throw err;
    }
  }
}

async function main() {
  console.log("============================================");
  console.log("APPLY ROBOT MIGRATIONS");
  console.log(`Target: ${NEW_REF}`);
  console.log(`Mode: ${VERIFY_ONLY ? "verify-only" : DRY_RUN ? "dry-run" : "apply"}`);
  console.log("============================================");

  const db = new PrismaClient({ datasources: { db: { url: URL } } });

  try {
    if (VERIFY_ONLY) {
      await verifyState(db);
      return;
    }

    const files = readdirSync(SQL_DIR)
      .filter((f) => f.startsWith("robot_infra_") && f.endsWith(".sql"))
      .sort();

    console.log(`\nArchivos a aplicar: ${files.length}`);
    for (const f of files) console.log(`  - ${f}`);

    for (const filename of files) {
      const sql = readFileSync(join(SQL_DIR, filename), "utf-8");
      await applyMigration(db, filename, sql);
    }

    console.log("\n## Verificando estado post-migracion");
    await verifyState(db);

    console.log("\n============================================");
    console.log("OK - Migraciones aplicadas correctamente");
    console.log("============================================\n");
  } finally {
    await db.$disconnect();
  }
}

main().catch((err) => {
  console.error("\n[FATAL]", err);
  process.exit(1);
});
