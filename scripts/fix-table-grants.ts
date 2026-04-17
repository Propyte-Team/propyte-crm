/**
 * Agrega GRANT SELECT en tablas base para anon/authenticated.
 * RLS filtra despues — pero sin GRANT no hay acceso siquiera a la tabla.
 *
 * Tambien GRANT USAGE en schema (requerido).
 */

import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";

config();

const NEW_REF = "oaijxdpevakashxshhvm";
const password = process.env.SUPABASE_DB_PASSWORD!;
const NEW_URL = `postgresql://postgres.${NEW_REF}:${encodeURIComponent(password)}@aws-1-us-east-1.pooler.supabase.com:5432/postgres`;

const PUBLIC_READABLE_TABLES = [
  "Propyte_desarrolladores",
  "Propyte_desarrollos",
  "Propyte_unidades",
  "Propyte_historial_precios",
  "Propyte_resenas",
];

const statements: Array<{ label: string; sql: string }> = [
  {
    label: "GRANT USAGE ON SCHEMA real_estate_hub TO anon, authenticated",
    sql: "GRANT USAGE ON SCHEMA real_estate_hub TO anon, authenticated",
  },
  {
    label: "GRANT USAGE ON SCHEMA real_estate_hub TO service_role",
    sql: "GRANT USAGE ON SCHEMA real_estate_hub TO service_role",
  },
  // service_role acceso total a schema
  {
    label: "GRANT ALL ON ALL TABLES IN SCHEMA real_estate_hub TO service_role",
    sql: "GRANT ALL ON ALL TABLES IN SCHEMA real_estate_hub TO service_role",
  },
  {
    label: "GRANT ALL ON ALL SEQUENCES IN SCHEMA real_estate_hub TO service_role",
    sql: "GRANT ALL ON ALL SEQUENCES IN SCHEMA real_estate_hub TO service_role",
  },
];

// GRANT SELECT en tablas publicas (RLS filtrara por policy)
for (const t of PUBLIC_READABLE_TABLES) {
  statements.push({
    label: `GRANT SELECT on ${t} TO anon, authenticated`,
    sql: `GRANT SELECT ON real_estate_hub."${t}" TO anon, authenticated`,
  });
}

async function main() {
  const db = new PrismaClient({ datasources: { db: { url: NEW_URL } } });
  try {
    console.log("\n=== Aplicando GRANTs ===\n");
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
    console.log("\n[SUCCESS]\n");
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
