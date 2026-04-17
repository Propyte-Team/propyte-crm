import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
config();
const NEW_URL = `postgresql://postgres.oaijxdpevakashxshhvm:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD!)}@aws-1-us-east-1.pooler.supabase.com:5432/postgres`;
async function main() {
  const db = new PrismaClient({ datasources: { db: { url: NEW_URL } } });
  try {
    await db.$executeRawUnsafe(`GRANT USAGE ON SCHEMA real_estate_hub TO authenticator`);
    console.log("[OK] GRANT USAGE TO authenticator");
    await db.$executeRawUnsafe(`NOTIFY pgrst, 'reload schema'`);
    console.log("[OK] NOTIFY pgrst reload");
  } finally { await db.$disconnect(); }
}
main();
