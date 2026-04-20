/**
 * Migrate investment_analytics schema + data:
 *   1. Aplica generated-investment-analytics.sql en NUEVA DB
 *   2. Copia public.rental_comparables (14,422 rows) -> investment_analytics.rental_comparables
 *   3. Copia public.airdna_metrics     (369,585 rows) -> investment_analytics.airdna_metrics (batched)
 *   4. Refresh MATERIALIZED VIEW rental_estimates
 *   5. Verifica counts final
 *
 * Uso:
 *   npx tsx scripts/migrate-investment-analytics.ts               (dry-run: scan only)
 *   npx tsx scripts/migrate-investment-analytics.ts --apply       (aplica DDL + copia data)
 *   npx tsx scripts/migrate-investment-analytics.ts --apply --skip-ddl  (solo copia data)
 */
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";
import { resolve } from "path";
config();

const OLD_URL = process.env.DATABASE_URL!;
const NEW_URL = `postgresql://postgres.oaijxdpevakashxshhvm:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD!)}@aws-1-us-east-1.pooler.supabase.com:5432/postgres`;

if (!OLD_URL.includes("yjbrynsykkycozeybykj")) {
  console.error("DATABASE_URL debe apuntar a la DB vieja (yjbrynsykkycozeybykj)");
  process.exit(1);
}

const APPLY = process.argv.includes("--apply");
const SKIP_DDL = process.argv.includes("--skip-ddl");

const SQL_PATH = resolve(__dirname, "generated-investment-analytics.sql");

const BATCH_AIRDNA = 5000;
const BATCH_RENTAL = 2000;

// Escapa para valores JS -> SQL literal. Solo strings/numbers/booleans/Dates/null.
function lit(v: any): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return Number.isFinite(v) ? v.toString() : "NULL";
  if (typeof v === "bigint") return v.toString();
  if (v instanceof Date) return `'${v.toISOString()}'::timestamptz`;
  // date-only comes as Date too via Prisma; handle string
  const s = String(v);
  return "'" + s.replace(/'/g, "''") + "'";
}

async function applyDDL(newDb: PrismaClient) {
  console.log("\n=== 1. Aplicando DDL ===\n");
  const sql = readFileSync(SQL_PATH, "utf8");

  // dividir por `;` a nivel de statement — hay funciones con $$, detectar esos bloques
  const statements: string[] = [];
  let current = "";
  let inDollar = false;
  for (const line of sql.split("\n")) {
    // detectar apertura/cierre de $$
    const dollarCount = (line.match(/\$\$/g) ?? []).length;
    if (dollarCount % 2 === 1) inDollar = !inDollar;
    current += line + "\n";
    if (!inDollar && line.trim().endsWith(";")) {
      const t = current.trim();
      // chequear si tiene algun contenido SQL real (no solo comentarios)
      const hasSQL = t
        .split("\n")
        .some((l) => l.trim() !== "" && !l.trim().startsWith("--"));
      if (hasSQL) statements.push(t);
      current = "";
    }
  }
  if (current.trim()) {
    const hasSQL = current
      .split("\n")
      .some((l) => l.trim() !== "" && !l.trim().startsWith("--"));
    if (hasSQL) statements.push(current.trim());
  }

  console.log(`  ${statements.length} statements a ejecutar`);
  let i = 0;
  for (const s of statements) {
    i++;
    const preview = s.split("\n")[0].slice(0, 80);
    try {
      await newDb.$executeRawUnsafe(s);
      console.log(`  [${i}/${statements.length}] OK: ${preview}`);
    } catch (e: any) {
      console.error(`  [${i}/${statements.length}] FAIL: ${preview}`);
      console.error(`    ${e.message.split("\n")[0]}`);
      throw e;
    }
  }
  console.log("\n  DDL aplicado.");
}

async function copyRentalComparables(oldDb: PrismaClient, newDb: PrismaClient) {
  console.log("\n=== 2. Copiar rental_comparables ===\n");
  const total = ((await oldDb.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM public.rental_comparables`
  )) as any[])[0].n;
  console.log(`  Rows origen: ${total}`);

  let copied = 0;
  for (let offset = 0; offset < total; offset += BATCH_RENTAL) {
    const batch = (await oldDb.$queryRawUnsafe(
      `SELECT id, source_portal, source_url, source_id, city, zone, state,
              property_type, rental_type, bedrooms, bathrooms, area_m2,
              monthly_rent_mxn, is_furnished, scraped_at, listing_date, active, created_at
       FROM public.rental_comparables
       ORDER BY id
       OFFSET $1 LIMIT $2`,
      offset,
      BATCH_RENTAL
    )) as any[];
    if (batch.length === 0) break;

    const values = batch
      .map(
        (r) =>
          `(${lit(r.id)}::uuid, ${lit(r.source_portal)}, ${lit(r.source_url)}, ${lit(r.source_id)}, ${lit(r.city)}, ${lit(r.zone)}, ${lit(r.state)}, ${lit(r.property_type)}, ${lit(r.rental_type)}, ${lit(r.bedrooms)}, ${lit(r.bathrooms)}, ${lit(r.area_m2)}, ${lit(r.monthly_rent_mxn)}, ${lit(r.is_furnished)}, ${lit(r.scraped_at)}, ${lit(r.listing_date)}, ${lit(r.active)}, ${lit(r.created_at)})`
      )
      .join(",\n");

    const sql = `INSERT INTO investment_analytics.rental_comparables
      (id, source_portal, source_url, source_id, city, zone, state, property_type, rental_type, bedrooms, bathrooms, area_m2, monthly_rent_mxn, is_furnished, scraped_at, listing_date, active, created_at)
      VALUES ${values}
      ON CONFLICT (id) DO NOTHING`;

    await newDb.$executeRawUnsafe(sql);
    copied += batch.length;
    console.log(`  [${copied}/${total}] (${Math.round((copied / total) * 100)}%)`);
  }
  console.log(`\n  ${copied} filas copiadas.`);
}

async function copyAirdnaMetrics(oldDb: PrismaClient, newDb: PrismaClient) {
  console.log("\n=== 3. Copiar airdna_metrics ===\n");
  const total = ((await oldDb.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM public.airdna_metrics`
  )) as any[])[0].n;
  console.log(`  Rows origen: ${total}`);

  let copied = 0;
  for (let offset = 0; offset < total; offset += BATCH_AIRDNA) {
    const batch = (await oldDb.$queryRawUnsafe(
      `SELECT id, market, submarket, section, chart, metric_date, metric_name,
              metric_value, scraped_at, created_at
       FROM public.airdna_metrics
       ORDER BY id
       OFFSET $1 LIMIT $2`,
      offset,
      BATCH_AIRDNA
    )) as any[];
    if (batch.length === 0) break;

    const values = batch
      .map(
        (r) =>
          `(${lit(r.id)}::uuid, ${lit(r.market)}, ${lit(r.submarket)}, ${lit(r.section)}, ${lit(r.chart)}, ${lit(r.metric_date)}, ${lit(r.metric_name)}, ${lit(r.metric_value)}, ${lit(r.scraped_at)}, ${lit(r.created_at)})`
      )
      .join(",\n");

    const sql = `INSERT INTO investment_analytics.airdna_metrics
      (id, market, submarket, section, chart, metric_date, metric_name, metric_value, scraped_at, created_at)
      VALUES ${values}
      ON CONFLICT (id) DO NOTHING`;

    await newDb.$executeRawUnsafe(sql);
    copied += batch.length;
    if (copied % (BATCH_AIRDNA * 4) === 0 || copied >= total) {
      console.log(`  [${copied}/${total}] (${Math.round((copied / total) * 100)}%)`);
    }
  }
  console.log(`\n  ${copied} filas copiadas.`);
}

async function refreshEstimates(newDb: PrismaClient) {
  console.log("\n=== 4. REFRESH rental_estimates ===\n");
  await newDb.$executeRawUnsafe(
    `REFRESH MATERIALIZED VIEW investment_analytics.rental_estimates`
  );
  const r = (await newDb.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM investment_analytics.rental_estimates`
  )) as any[];
  console.log(`  ${r[0].n} filas agregadas`);
}

async function verify(newDb: PrismaClient) {
  console.log("\n=== 5. Verificacion final ===\n");
  const tables = ["rental_comparables", "airdna_metrics", "development_financials"];
  for (const t of tables) {
    const r = (await newDb.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS n FROM investment_analytics."${t}"`
    )) as any[];
    console.log(`  investment_analytics.${t}: ${r[0].n} rows`);
  }
  const r = (await newDb.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM investment_analytics.rental_estimates`
  )) as any[];
  console.log(`  investment_analytics.rental_estimates (mat view): ${r[0].n} rows`);
}

async function main() {
  console.log(`Mode: ${APPLY ? (SKIP_DDL ? "APPLY (data only)" : "APPLY (full)") : "DRY-RUN"}`);

  const oldDb = new PrismaClient({ datasources: { db: { url: OLD_URL } } });
  const newDb = new PrismaClient({ datasources: { db: { url: NEW_URL } } });

  try {
    if (!APPLY) {
      console.log("\n(DRY-RUN: no se ejecuta nada. Corre con --apply para migrar)\n");
      const rc = (await oldDb.$queryRawUnsafe(
        `SELECT COUNT(*)::int AS n FROM public.rental_comparables`
      )) as any[];
      const am = (await oldDb.$queryRawUnsafe(
        `SELECT COUNT(*)::int AS n FROM public.airdna_metrics`
      )) as any[];
      console.log(`  Preview: copiariamos ${rc[0].n} rental_comparables + ${am[0].n} airdna_metrics`);
      return;
    }

    if (!SKIP_DDL) await applyDDL(newDb);
    await copyRentalComparables(oldDb, newDb);
    await copyAirdnaMetrics(oldDb, newDb);
    await refreshEstimates(newDb);
    await verify(newDb);

    console.log("\n[DONE] Migracion investment_analytics completa.");
    console.log("\nSIGUIENTE: agregar 'investment_analytics' a Exposed Schemas en dashboard Supabase (Settings > API).");
  } finally {
    await oldDb.$disconnect();
    await newDb.$disconnect();
  }
}
main().catch((e) => {
  console.error("\nFATAL:", e.message);
  process.exit(1);
});
