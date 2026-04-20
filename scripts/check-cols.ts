import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
config();
const p = process.env.SUPABASE_DB_PASSWORD!;
const pr = new PrismaClient({ datasourceUrl: `postgresql://postgres.oaijxdpevakashxshhvm:${encodeURIComponent(p)}@aws-1-us-east-1.pooler.supabase.com:5432/postgres` });
(async () => {
  for (const t of ["Propyte_desarrollos", "Propyte_unidades"]) {
    const r = await pr.$queryRawUnsafe<any[]>(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema='real_estate_hub' AND table_name=$1
        AND (column_name ILIKE '%nombre%' OR column_name ILIKE '%slug%' OR column_name ILIKE '%precio%' OR column_name ILIKE '%lat%' OR column_name ILIKE '%lng%' OR column_name ILIKE '%long%' OR column_name ILIKE '%ciudad%' OR column_name ILIKE '%tipo%' OR column_name='id_desarrollador' OR column_name='id_desarrollo')
      ORDER BY ordinal_position
    `, t);
    console.log(`\n${t}:`);
    r.forEach(c => console.log(`  ${c.column_name}`));
  }
  await pr.$disconnect();
})();
