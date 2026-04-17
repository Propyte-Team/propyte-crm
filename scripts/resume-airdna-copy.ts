/**
 * Resume copy of airdna_metrics desde el offset que ya tenemos en la nueva DB.
 * Usa ON CONFLICT (id) DO NOTHING para ser idempotente.
 */
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
config();

const OLD_URL = process.env.DATABASE_URL!;
const NEW_URL = `postgresql://postgres.oaijxdpevakashxshhvm:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD!)}@aws-1-us-east-1.pooler.supabase.com:5432/postgres`;

const BATCH = 5000;

function lit(v: any): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return Number.isFinite(v) ? v.toString() : "NULL";
  if (typeof v === "bigint") return v.toString();
  if (v instanceof Date) return `'${v.toISOString()}'::timestamptz`;
  const s = String(v);
  return "'" + s.replace(/'/g, "''") + "'";
}

async function main() {
  const oldDb = new PrismaClient({ datasources: { db: { url: OLD_URL } } });
  const newDb = new PrismaClient({ datasources: { db: { url: NEW_URL } } });
  try {
    const totalOld = ((await oldDb.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS n FROM public.airdna_metrics`
    )) as any[])[0].n;
    const countNew = ((await newDb.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS n FROM investment_analytics.airdna_metrics`
    )) as any[])[0].n;

    console.log(`Origen: ${totalOld} | Destino actual: ${countNew}`);
    if (countNew >= totalOld) {
      console.log("Todo copiado. OK.");
      return;
    }

    // empezar un poco antes del count actual por si hubo gaps
    const startOffset = Math.max(0, countNew - BATCH);
    console.log(`Reanudando desde offset ${startOffset}\n`);

    let copied = countNew;
    for (let offset = startOffset; offset < totalOld; offset += BATCH) {
      const batch = (await oldDb.$queryRawUnsafe(
        `SELECT id, market, submarket, section, chart, metric_date, metric_name,
                metric_value, scraped_at, created_at
         FROM public.airdna_metrics
         ORDER BY id
         OFFSET $1 LIMIT $2`,
        offset,
        BATCH
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

      // print cada batch para ver progreso
      const r = (await newDb.$queryRawUnsafe(
        `SELECT COUNT(*)::int AS n FROM investment_analytics.airdna_metrics`
      )) as any[];
      copied = r[0].n;
      console.log(`  offset=${offset + BATCH} | dst=${copied}/${totalOld} (${Math.round((copied / totalOld) * 100)}%)`);
    }

    console.log("\n=== Refresh rental_estimates ===");
    await newDb.$executeRawUnsafe(
      `REFRESH MATERIALIZED VIEW investment_analytics.rental_estimates`
    );
    const est = (await newDb.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS n FROM investment_analytics.rental_estimates`
    )) as any[];
    console.log(`rental_estimates: ${est[0].n} filas\n`);

    console.log("[DONE]");
  } finally {
    await oldDb.$disconnect();
    await newDb.$disconnect();
  }
}
main().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
