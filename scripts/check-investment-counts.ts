import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
config();
const NEW = `postgresql://postgres.oaijxdpevakashxshhvm:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD!)}@aws-1-us-east-1.pooler.supabase.com:5432/postgres`;
const db = new PrismaClient({ datasources: { db: { url: NEW } } });
(async () => {
  for (const t of ["rental_comparables", "airdna_metrics", "development_financials"]) {
    const r = (await db.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS n FROM investment_analytics."${t}"`
    )) as any[];
    console.log(`${t}: ${r[0].n}`);
  }
  const r = (await db.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM investment_analytics.rental_estimates`
  )) as any[];
  console.log(`rental_estimates (mat view): ${r[0].n}`);
  await db.$disconnect();
})();
