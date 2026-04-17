import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
config();
const NEW_URL = `postgresql://postgres.oaijxdpevakashxshhvm:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD!)}@aws-1-us-east-1.pooler.supabase.com:5432/postgres`;
async function main() {
  const db = new PrismaClient({ datasources: { db: { url: NEW_URL } } });
  try {
    // Locks activos
    console.log("=== Active locks ===\n");
    const locks = await db.$queryRawUnsafe(`
      SELECT
        pid, usename, application_name, state, query_start,
        wait_event_type, wait_event,
        LEFT(query, 150) as query
      FROM pg_stat_activity
      WHERE state != 'idle' AND datname = 'postgres'
      ORDER BY query_start
    `) as any[];
    for (const l of locks) {
      console.log(`pid=${l.pid} user=${l.usename} app=${l.application_name} state=${l.state}`);
      console.log(`  wait: ${l.wait_event_type}/${l.wait_event}`);
      console.log(`  query: ${l.query}\n`);
    }

    // Queries long-running
    console.log("=== Queries > 10s ===\n");
    const slow = await db.$queryRawUnsafe(`
      SELECT pid, usename, state, EXTRACT(EPOCH FROM (now() - query_start)) as dur_sec,
             LEFT(query, 200) as query
      FROM pg_stat_activity
      WHERE state = 'active' AND now() - query_start > interval '10 seconds'
    `) as any[];
    for (const s of slow) console.log(`pid=${s.pid} dur=${s.dur_sec}s: ${s.query}`);
    if (slow.length === 0) console.log("(ninguna)");
  } finally { await db.$disconnect(); }
}
main();
