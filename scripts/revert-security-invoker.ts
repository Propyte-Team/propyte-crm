import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
config();
const NEW_URL = `postgresql://postgres.oaijxdpevakashxshhvm:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD!)}@aws-1-us-east-1.pooler.supabase.com:5432/postgres`;
async function main() {
  const db = new PrismaClient({ datasources: { db: { url: NEW_URL } } });
  try {
    for (const v of ["v_developers","v_developments","v_units"]) {
      await db.$executeRawUnsafe(`ALTER VIEW real_estate_hub."${v}" RESET (security_invoker)`);
      console.log(`[OK] ${v} security_invoker reset`);
    }
    await db.$executeRawUnsafe(`NOTIFY pgrst, 'reload schema'`);
    console.log("[OK] reload");
  } finally { await db.$disconnect(); }
}
main();
