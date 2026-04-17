import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
config();
const NEW_URL = `postgresql://postgres.oaijxdpevakashxshhvm:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD!)}@aws-1-us-east-1.pooler.supabase.com:5432/postgres`;
async function main() {
  const db = new PrismaClient({ datasources: { db: { url: NEW_URL } } });
  try {
    // Grants mas completos para authenticator
    await db.$executeRawUnsafe(`GRANT USAGE ON SCHEMA real_estate_hub TO authenticator, anon, authenticated, service_role`);
    await db.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO authenticator, anon, authenticated, service_role`);
    console.log("[OK] USAGE grants");

    await db.$executeRawUnsafe(`NOTIFY pgrst, 'reload schema'`);
    await db.$executeRawUnsafe(`NOTIFY pgrst, 'reload config'`);
    console.log("[OK] NOTIFY signals");
  } finally { await db.$disconnect(); }
}
main();
