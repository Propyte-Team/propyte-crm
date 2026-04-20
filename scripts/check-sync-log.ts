import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
config();
const p = process.env.SUPABASE_DB_PASSWORD!;
const URL = `postgresql://postgres.oaijxdpevakashxshhvm:${encodeURIComponent(p)}@aws-1-us-east-1.pooler.supabase.com:5432/postgres`;
const pr = new PrismaClient({ datasourceUrl: URL });
(async () => {
  // Buscar cualquier tabla llamada Propyte_sync_log (plugin WP, diferente del zoho_sync_log)
  const r = await pr.$queryRawUnsafe<any[]>(`
    SELECT table_schema, table_name FROM information_schema.tables
    WHERE table_name ILIKE '%sync_log%'
    ORDER BY table_schema, table_name
  `);
  console.log("Tablas *sync_log*:");
  r.forEach(t => console.log(`  ${t.table_schema}.${t.table_name}`));

  // Chequear columnas del Propyte_sync_log (el del plugin WP) si existe
  const cols = await pr.$queryRawUnsafe<any[]>(`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_schema='real_estate_hub' AND table_name='Propyte_sync_log'
    ORDER BY ordinal_position
  `);
  if (cols.length > 0) {
    console.log("\nColumnas Propyte_sync_log (plugin WP):");
    cols.forEach(c => console.log(`  ${c.column_name} ${c.data_type}`));
  } else {
    console.log("\n  Propyte_sync_log (plugin WP): NO EXISTE");
  }
  await pr.$disconnect();
})();
