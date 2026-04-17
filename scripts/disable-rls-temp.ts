/**
 * Temporalmente desactiva RLS en real_estate_hub para aislar si es lo
 * que rompe el schema cache de PostgREST.
 *
 * Si PostgREST vuelve tras esto, el problema esta en las policies o
 * en alguna combinacion RLS + grant + columna agregada.
 */
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
config();

const NEW_URL = `postgresql://postgres.oaijxdpevakashxshhvm:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD!)}@aws-1-us-east-1.pooler.supabase.com:5432/postgres`;

const TABLES = [
  "Propyte_desarrolladores", "Propyte_desarrollos", "Propyte_unidades",
  "Propyte_historial_precios", "Propyte_resenas",
  "Propyte_zoho_leads", "Propyte_zoho_accounts", "Propyte_zoho_contacts",
  "Propyte_zoho_deals", "Propyte_zoho_id_map",
];

async function main() {
  const db = new PrismaClient({ datasources: { db: { url: NEW_URL } } });
  try {
    for (const t of TABLES) {
      await db.$executeRawUnsafe(`ALTER TABLE real_estate_hub."${t}" DISABLE ROW LEVEL SECURITY`);
      console.log(`[OK] RLS disabled on ${t}`);
    }
    await db.$executeRawUnsafe(`NOTIFY pgrst, 'reload schema'`);
    console.log("\n[OK] reload sent");
  } finally { await db.$disconnect(); }
}
main();
