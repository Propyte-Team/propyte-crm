import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";

config();

const NEW_URL = `postgresql://postgres.oaijxdpevakashxshhvm:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD!)}@aws-1-us-east-1.pooler.supabase.com:5432/postgres`;

async function main() {
  const db = new PrismaClient({ datasources: { db: { url: NEW_URL } } });
  await db.$executeRawUnsafe(`NOTIFY pgrst, 'reload schema'`);
  console.log("Cache reload notified");
  await db.$disconnect();
}
main();
