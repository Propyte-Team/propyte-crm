import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
config();

const URL = `postgresql://postgres.oaijxdpevakashxshhvm:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD!)}@aws-1-us-east-1.pooler.supabase.com:5432/postgres`;

async function main() {
  const db = new PrismaClient({ datasources: { db: { url: URL } } });
  try {
    const rows = (await db.$queryRawUnsafe(
      `SELECT errors FROM real_estate_hub."Propyte_robot_runs"
       WHERE robot_name = '01-classifier' AND errors IS NOT NULL
       ORDER BY started_at DESC LIMIT 1`
    )) as any[];

    if (rows.length === 0) {
      console.log("Sin errores registrados");
      return;
    }

    const errors = rows[0].errors as any[];
    console.log(`## ${errors.length} errores del ultimo run\n`);

    const byType = new Map<string, number>();
    for (const e of errors) {
      const msg = (e.err?.message ?? e.msg ?? "").slice(0, 150);
      const key = msg.replace(/[a-f0-9]{8,}/g, "UUID").replace(/\d+/g, "N");
      byType.set(key, (byType.get(key) ?? 0) + 1);
    }

    console.log("## Tipos de error (agrupados)\n");
    for (const [msg, count] of Array.from(byType.entries()).sort((a, b) => b[1] - a[1])) {
      console.log(`  [${count}] ${msg}`);
    }

    console.log("\n## Primer error (full detail)\n");
    const first = errors[0];
    console.log(JSON.stringify(first, null, 2).slice(0, 2000));
  } finally {
    await db.$disconnect();
  }
}
main();
