/**
 * REFRESH MATERIALIZED VIEW CONCURRENTLY investment_analytics.rental_estimates
 *
 * Corre diario via GitHub Actions (.github/workflows/refresh-rental-estimates.yml)
 * También se puede correr manual: npx tsx scripts/refresh-rental-estimates.ts
 *
 * Requiere que el mat view tenga un UNIQUE index (city+zone+property_type+bedrooms+rental_type)
 * para permitir REFRESH CONCURRENTLY (no bloquea lecturas).
 */
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";

config();

const password = process.env.SUPABASE_DB_PASSWORD;
if (!password) {
  console.error("Missing SUPABASE_DB_PASSWORD");
  process.exit(1);
}

const URL = `postgresql://postgres.oaijxdpevakashxshhvm:${encodeURIComponent(password)}@aws-1-us-east-1.pooler.supabase.com:5432/postgres`;
const prisma = new PrismaClient({ datasourceUrl: URL });

async function main() {
  const start = Date.now();
  console.log("Refreshing investment_analytics.rental_estimates…");
  await prisma.$executeRawUnsafe(
    `REFRESH MATERIALIZED VIEW CONCURRENTLY investment_analytics.rental_estimates`
  );
  const r = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT COUNT(*)::bigint AS count FROM investment_analytics.rental_estimates`
  );
  console.log(`OK ${r[0].count} rows in ${Date.now() - start}ms`);
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
