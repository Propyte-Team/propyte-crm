import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
config();
const p = process.env.SUPABASE_DB_PASSWORD!;
const pr = new PrismaClient({ datasourceUrl: `postgresql://postgres.oaijxdpevakashxshhvm:${encodeURIComponent(p)}@aws-1-us-east-1.pooler.supabase.com:5432/postgres` });
(async () => {
  const r = await pr.$queryRawUnsafe<any[]>(`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_schema='real_estate_hub' AND table_name='Propyte_desarrollos'
      AND (column_name ILIKE 'amenidad%' OR column_name ILIKE 'amenities%')
    ORDER BY ordinal_position
  `);
  console.log("Amenity-related columns:");
  r.forEach(c => console.log(`  ${c.data_type.padEnd(20)} ${c.column_name}`));
  await pr.$disconnect();
})();
