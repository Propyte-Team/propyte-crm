import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
config();

const URL = `postgresql://postgres.oaijxdpevakashxshhvm:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD!)}@aws-1-us-east-1.pooler.supabase.com:5432/postgres`;

async function main() {
  const db = new PrismaClient({ datasources: { db: { url: URL } } });
  try {
    console.log("## Columnas de Propyte_unidades que mencionan source/url/ext\n");
    const cols = (await db.$queryRawUnsafe(
      `SELECT column_name, data_type
       FROM information_schema.columns
       WHERE table_schema = 'real_estate_hub' AND table_name = 'Propyte_unidades'
       AND (column_name LIKE '%source%' OR column_name LIKE '%url%' OR column_name LIKE 'ext_%' OR column_name LIKE '%slug%' OR column_name LIKE '%legacy%')
       ORDER BY column_name`
    )) as any[];
    for (const c of cols) console.log(`  ${c.column_name}: ${c.data_type}`);

    console.log("\n## Columnas de Propyte_desarrollos equivalentes\n");
    const cols2 = (await db.$queryRawUnsafe(
      `SELECT column_name, data_type
       FROM information_schema.columns
       WHERE table_schema = 'real_estate_hub' AND table_name = 'Propyte_desarrollos'
       AND (column_name LIKE '%source%' OR column_name LIKE '%url%' OR column_name LIKE 'ext_%' OR column_name LIKE '%slug%' OR column_name LIKE '%legacy%')
       ORDER BY column_name`
    )) as any[];
    for (const c of cols2) console.log(`  ${c.column_name}: ${c.data_type}`);
  } finally {
    await db.$disconnect();
  }
}
main();
