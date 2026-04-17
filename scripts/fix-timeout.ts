import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
config();
const NEW_URL = `postgresql://postgres.oaijxdpevakashxshhvm:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD!)}@aws-1-us-east-1.pooler.supabase.com:5432/postgres`;
async function main() {
  const db = new PrismaClient({ datasources: { db: { url: NEW_URL } } });
  try {
    await db.$executeRawUnsafe(`ALTER ROLE authenticator SET statement_timeout = '30s'`);
    console.log("[OK] statement_timeout = 30s");
    await db.$executeRawUnsafe(`ALTER ROLE authenticator SET lock_timeout = '30s'`);
    console.log("[OK] lock_timeout = 30s");
    await db.$executeRawUnsafe(`NOTIFY pgrst, 'reload config'`);
    await db.$executeRawUnsafe(`NOTIFY pgrst, 'reload schema'`);
    console.log("[OK] reloads");
  } finally { await db.$disconnect(); }
}
main();
