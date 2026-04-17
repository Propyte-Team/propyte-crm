import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";

config();

const NEW_REF = "oaijxdpevakashxshhvm";
const password = process.env.SUPABASE_DB_PASSWORD!;
const NEW_URL = `postgresql://postgres.${NEW_REF}:${encodeURIComponent(password)}@aws-1-us-east-1.pooler.supabase.com:5432/postgres`;

async function main() {
  const db = new PrismaClient({ datasources: { db: { url: NEW_URL } } });
  try {
    await db.$executeRawUnsafe('DROP SCHEMA IF EXISTS "Borrador" CASCADE');
    console.log("[OK] Borrador eliminado");

    const remaining = (await db.$queryRawUnsafe(
      "SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT LIKE 'pg_%' AND schema_name != 'information_schema' ORDER BY schema_name"
    )) as Array<{ schema_name: string }>;
    console.log("Schemas:", remaining.map((r) => r.schema_name).join(", "));
  } finally {
    await db.$disconnect();
  }
}
main();
