// ============================================================
// Script: Migrar datos de Neon PostgreSQL → Supabase propyte_crm
// Lee con raw SQL (bypass multiSchema config) y escribe con Supabase client
// Ejecutar: npx tsx scripts/migrate-to-supabase.ts
// ============================================================

import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";

// Prisma connects to Neon via DATABASE_URL in .env
// We use $queryRawUnsafe to read from public schema (bypasses multiSchema config)
const prisma = new PrismaClient();

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key);
}

const supabase = getSupabase();
const SCHEMA = "propyte_crm";
const BATCH_SIZE = 500;

// Read from Neon (public schema) via raw SQL
async function readTable(table: string): Promise<Record<string, unknown>[]> {
  return prisma.$queryRawUnsafe(`SELECT * FROM public."${table}"`) as Promise<Record<string, unknown>[]>;
}

// Write to Supabase propyte_crm in batches
async function batchUpsert(table: string, rows: Record<string, unknown>[]) {
  if (rows.length === 0) {
    console.log(`  ${table}: 0 registros (vacío)`);
    return;
  }

  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase
      .schema(SCHEMA)
      .from(table)
      .upsert(batch, { onConflict: "id" });

    if (error) {
      console.error(`  ERROR en ${table} (batch ${i}-${i + batch.length}):`, error.message);
      // Try one by one
      for (const row of batch) {
        const { error: err2 } = await supabase.schema(SCHEMA).from(table).upsert(row, { onConflict: "id" });
        if (err2) {
          console.error(`    Row ${row.id}:`, err2.message);
        } else {
          inserted++;
        }
      }
    } else {
      inserted += batch.length;
    }
  }
  console.log(`  ${table}: ${inserted}/${rows.length} registros migrados`);
}

// Convert Prisma Decimal to number for Supabase
function cleanRow(row: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(row)) {
    if (val !== undefined) {
      // Prisma Decimal objects → number
      if (val !== null && typeof val === "object" && "toNumber" in (val as object)) {
        cleaned[key] = (val as { toNumber: () => number }).toNumber();
      } else {
        cleaned[key] = val;
      }
    }
  }
  return cleaned;
}

async function migrateTable(table: string, label: string) {
  console.log(`\n${label} Migrando ${table}...`);
  const rows = await readTable(table);
  await batchUpsert(table, rows.map(cleanRow));
}

async function main() {
  console.log("=== MIGRACIÓN NEON → SUPABASE (propyte_crm) ===\n");
  console.log(`Supabase URL: ${process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL}`);
  console.log(`Schema: ${SCHEMA}`);

  const start = Date.now();

  // Orden respeta foreign keys
  await migrateTable("users",              "[1/17]");
  await migrateTable("contacts",           "[2/17]");
  await migrateTable("developments",       "[3/17]");
  await migrateTable("units",              "[4/17]");
  await migrateTable("deals",              "[5/17]");
  await migrateTable("activities",         "[6/17]");
  await migrateTable("commission_rules",   "[7/17]");
  await migrateTable("walk_ins",           "[8/17]");
  await migrateTable("audit_logs",         "[9/17]");
  await migrateTable("notifications",      "[10/17]");
  await migrateTable("messages",           "[11/17]");
  await migrateTable("system_config",      "[12/17]");
  await migrateTable("webhook_configs",    "[13/17]");
  await migrateTable("monitored_folders",  "[14/17]");
  await migrateTable("meta_ad_accounts",   "[15/17]");
  await migrateTable("meta_campaign_cache","[16/17]");
  await migrateTable("meta_daily_insights","[17/17]");

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n=== MIGRACIÓN COMPLETADA en ${elapsed}s ===`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("FATAL:", err);
  prisma.$disconnect();
  process.exit(1);
});
