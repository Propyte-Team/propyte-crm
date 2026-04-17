/**
 * Lee indexes y constraints de public.rental_comparables y public.airdna_metrics
 * en la DB VIEJA, para replicarlos en investment_analytics de la nueva DB.
 */
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
config();

const OLD_URL = process.env.DATABASE_URL!;
if (!OLD_URL.includes("yjbrynsykkycozeybykj")) {
  console.error("DATABASE_URL no apunta a DB vieja");
  process.exit(1);
}

const TABLES = ["rental_comparables", "airdna_metrics"];

async function main() {
  const db = new PrismaClient({ datasources: { db: { url: OLD_URL } } });
  try {
    for (const t of TABLES) {
      console.log(`\n=== public.${t} ===\n`);

      // indexes (incluyendo PKs)
      const idx = (await db.$queryRawUnsafe(
        `SELECT indexname, indexdef FROM pg_indexes
         WHERE schemaname = 'public' AND tablename = $1
         ORDER BY indexname`,
        t
      )) as Array<{ indexname: string; indexdef: string }>;
      console.log(`Indexes (${idx.length}):`);
      for (const i of idx) console.log(`  ${i.indexdef}`);

      // constraints (PK, UNIQUE, CHECK, NOT NULL ya vimos en scan previo)
      const cons = (await db.$queryRawUnsafe(
        `SELECT con.conname, con.contype,
                pg_get_constraintdef(con.oid) as def
         FROM pg_constraint con
         JOIN pg_class cl ON cl.oid = con.conrelid
         JOIN pg_namespace n ON n.oid = cl.relnamespace
         WHERE n.nspname = 'public' AND cl.relname = $1`,
        t
      )) as Array<{ conname: string; contype: string; def: string }>;
      console.log(`\nConstraints (${cons.length}):`);
      for (const c of cons) {
        const kind =
          c.contype === "p" ? "PK" : c.contype === "u" ? "UNIQUE" : c.contype === "c" ? "CHECK" : c.contype === "f" ? "FK" : c.contype;
        console.log(`  [${kind}] ${c.conname}: ${c.def}`);
      }

      // triggers (por si hay alguno sobre raw data)
      const trg = (await db.$queryRawUnsafe(
        `SELECT tgname, pg_get_triggerdef(oid) as def
         FROM pg_trigger
         WHERE tgrelid = ('"public"."' || $1 || '"')::regclass
           AND NOT tgisinternal`,
        t
      )) as Array<{ tgname: string; def: string }>;
      if (trg.length > 0) {
        console.log(`\nTriggers (${trg.length}):`);
        for (const g of trg) console.log(`  ${g.def}`);
      }
    }
  } finally {
    await db.$disconnect();
  }
}
main().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
