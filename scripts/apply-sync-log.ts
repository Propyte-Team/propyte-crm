/**
 * Aplica create_propyte_sync_log.sql a la NUEVA DB.
 * Uso: npx tsx scripts/apply-sync-log.ts
 */
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";
import { join } from "path";

config();

const password = process.env.SUPABASE_DB_PASSWORD!;
const URL = `postgresql://postgres.oaijxdpevakashxshhvm:${encodeURIComponent(password)}@aws-1-us-east-1.pooler.supabase.com:5432/postgres`;
const prisma = new PrismaClient({ datasourceUrl: URL });

async function main() {
  const raw = readFileSync(join(__dirname, "sql", "create_propyte_sync_log.sql"), "utf-8");
  // Strip full-line comments before splitting so they don't get glued to the next statement
  const sql = raw.split("\n").filter(l => !l.trim().startsWith("--")).join("\n");
  const stmts = sql.split(/;\s*(?:\n|$)/).map(s => s.trim()).filter(s => s.length > 0);

  for (const stmt of stmts) {
    const preview = stmt.replace(/\s+/g, " ").slice(0, 80);
    try {
      await prisma.$executeRawUnsafe(stmt);
      console.log(`OK  ${preview}`);
    } catch (e: any) {
      console.log(`ERR ${preview}`);
      console.log(`    ${e.message?.slice(0, 200)}`);
    }
  }

  const r = await prisma.$queryRawUnsafe<Array<{ column_name: string; data_type: string }>>(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema='real_estate_hub' AND table_name='Propyte_sync_log'
    ORDER BY ordinal_position
  `);
  console.log(`\nPropyte_sync_log columnas (${r.length}):`);
  r.forEach(c => console.log(`  ${c.column_name} ${c.data_type}`));

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
