/**
 * Crea un pg_cron job para refrescar rental_estimates diariamente 05:00 UTC.
 *
 * Reemplaza el GitHub Actions workflow (refresh-rental-estimates.yml) —
 * pg_cron es más eficiente: no requiere secretos, no hay latencia de spin-up
 * de runner, y no consume minutos de GH Actions.
 *
 * Uso: npx tsx scripts/setup-pg-cron-refresh.ts [--unschedule]
 */
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";

config();

const UNSCHEDULE = process.argv.includes("--unschedule");
const pwd = process.env.SUPABASE_DB_PASSWORD!;
const URL = `postgresql://postgres.oaijxdpevakashxshhvm:${encodeURIComponent(pwd)}@aws-1-us-east-1.pooler.supabase.com:5432/postgres`;
const db = new PrismaClient({ datasourceUrl: URL });

const JOB_NAME = "refresh-rental-estimates";

async function main() {
  if (UNSCHEDULE) {
    await db.$executeRawUnsafe(`SELECT cron.unschedule('${JOB_NAME}')`);
    console.log(`Unscheduled '${JOB_NAME}'`);
    await db.$disconnect();
    return;
  }

  // Idempotente: si ya existe con mismo nombre, unschedule primero
  try {
    await db.$executeRawUnsafe(`SELECT cron.unschedule('${JOB_NAME}')`);
    console.log(`(previous '${JOB_NAME}' unscheduled)`);
  } catch {
    // Job no existía, OK
  }

  // Cada día 05:00 UTC
  await db.$executeRawUnsafe(`
    SELECT cron.schedule(
      '${JOB_NAME}',
      '0 5 * * *',
      $$REFRESH MATERIALIZED VIEW CONCURRENTLY investment_analytics.rental_estimates$$
    )
  `);

  const jobs = await db.$queryRawUnsafe<Array<{ jobid: number; jobname: string; schedule: string; command: string; active: boolean }>>(`
    SELECT jobid, jobname, schedule, command, active
    FROM cron.job WHERE jobname = '${JOB_NAME}'
  `);
  console.log(`\nJob configurado:`);
  jobs.forEach(j => {
    console.log(`  jobid=${j.jobid}  ${j.jobname}  schedule="${j.schedule}"  active=${j.active}`);
    console.log(`  cmd: ${j.command.slice(0, 100)}${j.command.length > 100 ? "…" : ""}`);
  });

  await db.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
