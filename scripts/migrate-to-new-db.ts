// ============================================================
// Migración completa a nueva Supabase DB (oaijxdpevakashxshhvm)
//
// EJECUTAR ANTES de cambiar DATABASE_URL:
//   npx tsx scripts/migrate-to-new-db.ts
//
// Lee de:
//   - Prisma (DATABASE_URL → vieja DB): usuarios + real_estate_hub.Propyte_zoho_*
// Escribe a:
//   - Supabase client (SUPABASE_URL → nueva DB): real_estate_hub.Propyte_zoho_*
//   - Genera JSON con usuarios para seed posterior
//
// Pasos post-script:
//   1. Actualizar DATABASE_URL en .env al nuevo pooler
//   2. npx prisma db push
//   3. npx tsx scripts/seed-admin-users.ts
// ============================================================

import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

const prisma = new PrismaClient();

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key);
}

// ============================================================
// FASE 0: Crear tabla Propyte_zoho_sync_log si no existe
// ============================================================

async function createSyncLogTable(supabase: ReturnType<typeof createClient>) {
  console.log("\n=== FASE 0: Crear Propyte_zoho_sync_log en nueva DB ===");

  const ddl = `
    CREATE TABLE IF NOT EXISTS real_estate_hub."Propyte_zoho_sync_log" (
      "id" uuid DEFAULT gen_random_uuid() PRIMARY KEY,
      "sync_run_id" text NOT NULL,
      "direction" text NOT NULL,
      "entity_type" text NOT NULL,
      "operation" text NOT NULL,
      "record_id" text,
      "zoho_record_id" text,
      "details" jsonb,
      "error_message" text,
      "created_at" timestamptz DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_sync_log_run
      ON real_estate_hub."Propyte_zoho_sync_log" ("sync_run_id");
    CREATE INDEX IF NOT EXISTS idx_sync_log_entity_op
      ON real_estate_hub."Propyte_zoho_sync_log" ("entity_type", "operation");
    CREATE INDEX IF NOT EXISTS idx_sync_log_created
      ON real_estate_hub."Propyte_zoho_sync_log" ("created_at" DESC);

    -- Grants para service_role (ya tiene por ser superuser), agregar para completeness
    GRANT SELECT, INSERT ON real_estate_hub."Propyte_zoho_sync_log" TO authenticated;
    GRANT ALL ON real_estate_hub."Propyte_zoho_sync_log" TO service_role;
  `;

  const { error } = await supabase.rpc("exec_sql", { sql: ddl });

  if (error) {
    // Si rpc no existe, intentar via raw — Supabase no siempre tiene exec_sql
    console.log("  rpc exec_sql no disponible, intentando vía Prisma $executeRawUnsafe...");

    // Usamos la vieja DB via Prisma para ejecutar el DDL en la nueva DB
    // NO — Prisma apunta a la vieja. Necesitamos conexión directa a la nueva.
    // Generamos el SQL para que el usuario lo ejecute en el SQL Editor
    const sqlFile = path.join(__dirname, "sql", "create_zoho_sync_log.sql");
    fs.mkdirSync(path.dirname(sqlFile), { recursive: true });
    fs.writeFileSync(sqlFile, ddl.trim());
    console.log(`  ⚠ No se pudo crear automáticamente.`);
    console.log(`  SQL guardado en: scripts/sql/create_zoho_sync_log.sql`);
    console.log(`  → Ejecutar manualmente en Supabase SQL Editor ANTES de continuar.`);
    return false;
  }

  console.log("  ✓ Tabla Propyte_zoho_sync_log creada en nueva DB");
  return true;
}

// ============================================================
// FASE 1: Leer usuarios de la vieja DB
// ============================================================

async function readUsersFromOldDb(emails: string[]) {
  console.log("\n=== FASE 1: Leer usuarios de vieja DB ===");

  const users = [];
  for (const email of emails) {
    const result = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT * FROM propyte_crm.users WHERE email = $1`,
      email
    );
    if (result.length > 0) {
      console.log(`  ✓ ${email} — rol: ${result[0].role}, plaza: ${result[0].plaza}`);
      users.push(result[0]);
    } else {
      console.log(`  ✗ ${email} — NO encontrado en vieja DB`);
    }
  }

  return users;
}

// ============================================================
// FASE 2: Leer datos Zoho de vieja DB (real_estate_hub schema)
// ============================================================

async function readZohoDataFromOldDb() {
  console.log("\n=== FASE 2: Leer datos Zoho de vieja DB ===");

  const tables = [
    "Propyte_zoho_leads",
    "Propyte_zoho_contacts",
    "Propyte_zoho_deals",
    "Propyte_zoho_accounts",
    "Propyte_zoho_id_map",
  ];

  const data: Record<string, Record<string, unknown>[]> = {};

  for (const table of tables) {
    try {
      const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT * FROM real_estate_hub."${table}"`
      );
      data[table] = rows;
      console.log(`  ✓ ${table}: ${rows.length} registros`);
    } catch (err) {
      console.log(`  ✗ ${table}: ${err instanceof Error ? err.message : String(err)}`);
      data[table] = [];
    }
  }

  // También leer MetaLeads de Prisma (propyte_crm schema)
  try {
    const metaLeads = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT * FROM propyte_crm.meta_leads`
    );
    data["meta_leads"] = metaLeads;
    console.log(`  ✓ meta_leads (Prisma): ${metaLeads.length} registros`);
  } catch (err) {
    console.log(`  ✗ meta_leads: ${err instanceof Error ? err.message : String(err)}`);
    data["meta_leads"] = [];
  }

  return data;
}

// ============================================================
// FASE 3: Escribir datos Zoho a nueva DB (via Supabase client)
// ============================================================

async function writeZohoDataToNewDb(
  supabase: ReturnType<typeof createClient>,
  data: Record<string, Record<string, unknown>[]>
) {
  console.log("\n=== FASE 3: Escribir datos Zoho a nueva DB ===");

  const zohoTables = [
    "Propyte_zoho_leads",
    "Propyte_zoho_contacts",
    "Propyte_zoho_deals",
    "Propyte_zoho_accounts",
    "Propyte_zoho_id_map",
  ];

  for (const table of zohoTables) {
    const rows = data[table];
    if (!rows || rows.length === 0) {
      console.log(`  - ${table}: 0 registros, skip`);
      continue;
    }

    // Limpiar campos que Prisma devuelve como objetos Decimal
    const cleaned = rows.map((row) => {
      const clean: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(row)) {
        if (value !== null && typeof value === "object" && "toNumber" in (value as object)) {
          clean[key] = (value as { toNumber: () => number }).toNumber();
        } else if (value instanceof Date) {
          clean[key] = value.toISOString();
        } else if (typeof value === "bigint") {
          clean[key] = Number(value);
        } else {
          clean[key] = value;
        }
      }
      return clean;
    });

    // Batch upsert en chunks de 500
    const chunkSize = 500;
    let succeeded = 0;
    let errors = 0;

    for (let i = 0; i < cleaned.length; i += chunkSize) {
      const chunk = cleaned.slice(i, i + chunkSize);

      // Determinar ON CONFLICT column
      const onConflict = table === "Propyte_zoho_id_map"
        ? "entity_type,supabase_id"
        : "zoho_record_id";

      const { error } = await supabase
        .schema("real_estate_hub")
        .from(table)
        .upsert(chunk, { onConflict });

      if (error) {
        console.log(`  ✗ ${table} chunk ${i}-${i + chunk.length}: ${error.message}`);
        errors += chunk.length;
      } else {
        succeeded += chunk.length;
      }
    }

    console.log(`  ✓ ${table}: ${succeeded} escritos, ${errors} errores`);
  }
}

// ============================================================
// FASE 4: Guardar datos de usuarios para seed posterior
// ============================================================

function saveUserDataForSeed(users: Record<string, unknown>[]) {
  console.log("\n=== FASE 4: Guardar datos de usuarios ===");

  if (users.length === 0) {
    console.log("  ⚠ No se encontraron usuarios para migrar");
    return;
  }

  const seedData = users.map((u) => ({
    email: u.email,
    name: u.name,
    role: u.role,
    plaza: u.plaza,
    careerLevel: u.careerLevel || u.career_level || "SR",
    passwordHash: u.passwordHash || u.password_hash,
    isActive: u.isActive ?? u.is_active ?? true,
    phone: u.phone || null,
    avatarUrl: u.avatarUrl || u.avatar_url || null,
  }));

  const outPath = path.join(__dirname, "migrated-users.json");
  fs.writeFileSync(outPath, JSON.stringify(seedData, null, 2));
  console.log(`  ✓ ${seedData.length} usuarios guardados en scripts/migrated-users.json`);
  for (const u of seedData) {
    console.log(`    - ${u.email} (${u.role}, ${u.plaza})`);
  }
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║  MIGRACIÓN A NUEVA SUPABASE DB                  ║");
  console.log("║  Vieja (Prisma) → Nueva (Supabase client)       ║");
  console.log("╚══════════════════════════════════════════════════╝");

  const supabase = getSupabase();

  // FASE 0: Crear tabla sync_log
  await createSyncLogTable(supabase);

  // FASE 1: Leer usuarios
  const targetEmails = ["nacho@propyte.com", "marketing@nativatulum.mx"];
  const users = await readUsersFromOldDb(targetEmails);

  // FASE 2: Leer datos Zoho
  const zohoData = await readZohoDataFromOldDb();

  // FASE 3: Escribir datos Zoho a nueva DB
  await writeZohoDataToNewDb(supabase, zohoData);

  // FASE 4: Guardar usuarios
  saveUserDataForSeed(users);

  // Resumen
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║  RESUMEN                                         ║");
  console.log("╚══════════════════════════════════════════════════╝");
  console.log(`  Usuarios encontrados: ${users.length}/${targetEmails.length}`);
  for (const table of Object.keys(zohoData)) {
    console.log(`  ${table}: ${zohoData[table].length} registros migrados`);
  }

  console.log("\n🔜 PASOS SIGUIENTES:");
  console.log("  1. Si Propyte_zoho_sync_log no se creó, ejecutar SQL en Supabase SQL Editor");
  console.log("  2. Actualizar DATABASE_URL en .env:");
  console.log("     postgresql://postgres.oaijxdpevakashxshhvm:<PASSWORD>@aws-1-us-east-1.pooler.supabase.com:5432/postgres");
  console.log("     (usar SUPABASE_DB_PASSWORD como <PASSWORD>)");
  console.log("  3. npx prisma db push");
  console.log("  4. npx tsx scripts/seed-migrated-users.ts");
}

main()
  .catch((e) => {
    console.error("\n❌ Error fatal:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
