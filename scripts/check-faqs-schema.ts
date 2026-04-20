import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
config();
const p = process.env.SUPABASE_DB_PASSWORD!;
const pr = new PrismaClient({ datasourceUrl: `postgresql://postgres.oaijxdpevakashxshhvm:${encodeURIComponent(p)}@aws-1-us-east-1.pooler.supabase.com:5432/postgres` });
(async () => {
  const r = await pr.$queryRawUnsafe<any[]>(`
    SELECT column_name, data_type, is_nullable FROM information_schema.columns
    WHERE table_schema='real_estate_hub' AND table_name='Propyte_faqs_zona'
    ORDER BY ordinal_position
  `);
  r.forEach(c => console.log(`  ${c.column_name} ${c.data_type} ${c.is_nullable === 'YES' ? 'nullable' : 'NOT NULL'}`));
  await pr.$disconnect();
})();
