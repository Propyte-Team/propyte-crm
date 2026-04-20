import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
config();
const p = process.env.SUPABASE_DB_PASSWORD!;
const pr = new PrismaClient({ datasourceUrl: `postgresql://postgres.oaijxdpevakashxshhvm:${encodeURIComponent(p)}@aws-1-us-east-1.pooler.supabase.com:5432/postgres` });
(async () => {
  const r = await pr.$queryRawUnsafe<any[]>(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='real_estate_hub' AND table_name='Propyte_desarrollos' AND column_name ILIKE 'amenidad_%'
    ORDER BY ordinal_position
  `);
  console.log(`${r.length} amenity columns:`);
  for (const c of r) {
    const s = await pr.$queryRawUnsafe<any[]>(`SELECT COUNT(*) FILTER (WHERE "${c.column_name}"=true)::int AS t FROM real_estate_hub."Propyte_desarrollos" WHERE deleted_at IS NULL`);
    console.log(`  ${c.column_name.padEnd(40)} ${s[0].t}/627`);
  }
  await pr.$disconnect();
})();
