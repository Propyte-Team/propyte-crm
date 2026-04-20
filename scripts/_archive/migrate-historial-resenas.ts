/**
 * Migra Propyte_historial_precios y Propyte_resenas desde la DB vieja
 * (yjbrynsykkycozeybykj) a la NUEVA (oaijxdpevakashxshhvm).
 *
 * Idempotente: ON CONFLICT (id) DO NOTHING.
 * Chequea que las tablas destino existan y estén vacías antes de mover.
 *
 * Requiere:
 *   - SUPABASE_DB_PASSWORD        (nueva)
 *   - OLD_SUPABASE_DB_PASSWORD    (vieja) — no existe por default, pasar inline
 *
 * Uso:
 *   OLD_SUPABASE_DB_PASSWORD=xxx npx tsx scripts/migrate-historial-resenas.ts
 *   OLD_SUPABASE_DB_PASSWORD=xxx npx tsx scripts/migrate-historial-resenas.ts --dry-run
 */
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";

config();

const DRY_RUN = process.argv.includes("--dry-run");

const newPwd = process.env.SUPABASE_DB_PASSWORD;
const oldPwd = process.env.OLD_SUPABASE_DB_PASSWORD;
if (!newPwd) { console.error("Missing SUPABASE_DB_PASSWORD"); process.exit(1); }
if (!oldPwd) { console.error("Missing OLD_SUPABASE_DB_PASSWORD (password de DB vieja yjbrynsykkycozeybykj)"); process.exit(1); }

const NEW_URL = `postgresql://postgres.oaijxdpevakashxshhvm:${encodeURIComponent(newPwd)}@aws-1-us-east-1.pooler.supabase.com:5432/postgres`;
const OLD_URL = `postgresql://postgres.yjbrynsykkycozeybykj:${encodeURIComponent(oldPwd)}@aws-1-us-east-1.pooler.supabase.com:5432/postgres`;

const oldDb = new PrismaClient({ datasourceUrl: OLD_URL });
const newDb = new PrismaClient({ datasourceUrl: NEW_URL });

const BATCH = 500;

async function migrateTable(tableName: string) {
  console.log(`\n=== ${tableName} ===`);

  // Leer esquema destino (columnas)
  const destCols = await newDb.$queryRawUnsafe<Array<{ column_name: string }>>(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='real_estate_hub' AND table_name=$1
    ORDER BY ordinal_position
  `, tableName);
  const colNames = destCols.map(c => c.column_name);
  if (colNames.length === 0) {
    console.log(`  [SKIP] tabla destino no existe`);
    return;
  }

  // Contar origen y destino
  const [oldCount, newCount] = await Promise.all([
    oldDb.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT COUNT(*)::bigint AS count FROM real_estate_hub."${tableName}"`).catch(() => [{ count: 0n } as any]),
    newDb.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT COUNT(*)::bigint AS count FROM real_estate_hub."${tableName}"`),
  ]);
  console.log(`  vieja: ${oldCount[0].count} rows  →  nueva: ${newCount[0].count} rows`);

  if (oldCount[0].count === 0n) {
    console.log(`  [SKIP] vieja vacía, nada que migrar`);
    return;
  }

  // Filtrar columnas de origen a solo las que existen en destino
  const origCols = await oldDb.$queryRawUnsafe<Array<{ column_name: string }>>(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='real_estate_hub' AND table_name=$1
    ORDER BY ordinal_position
  `, tableName);
  const common = origCols.map(c => c.column_name).filter(c => colNames.includes(c));
  console.log(`  columnas comunes: ${common.length} (ej: ${common.slice(0, 5).join(", ")}…)`);

  if (DRY_RUN) {
    console.log(`  [DRY RUN] no se escribe`);
    return;
  }

  // Copiar por batches
  const colList = common.map(c => `"${c}"`).join(", ");
  let offset = 0;
  let total = 0;
  while (true) {
    const rows = await oldDb.$queryRawUnsafe<any[]>(
      `SELECT ${colList} FROM real_estate_hub."${tableName}"
       ORDER BY id LIMIT ${BATCH} OFFSET ${offset}`
    );
    if (rows.length === 0) break;

    // Insertar bulk con ON CONFLICT DO NOTHING
    for (const row of rows) {
      const placeholders = common.map((_, i) => `$${i + 1}`).join(", ");
      const values = common.map(c => row[c]);
      try {
        await newDb.$executeRawUnsafe(
          `INSERT INTO real_estate_hub."${tableName}" (${colList})
           VALUES (${placeholders})
           ON CONFLICT (id) DO NOTHING`,
          ...values
        );
        total++;
      } catch (e: any) {
        console.log(`  [ERR row ${row.id}] ${e.message?.slice(0, 120)}`);
      }
    }
    offset += BATCH;
    console.log(`  migrated ${total}/${oldCount[0].count}…`);
  }

  const finalCount = await newDb.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT COUNT(*)::bigint AS count FROM real_estate_hub."${tableName}"`);
  console.log(`  FINAL: ${finalCount[0].count} rows en nueva`);
}

async function main() {
  console.log(`${DRY_RUN ? "[DRY RUN] " : ""}Migración historial_precios + resenas`);
  try {
    await migrateTable("Propyte_historial_precios");
    await migrateTable("Propyte_resenas");
  } finally {
    await oldDb.$disconnect();
    await newDb.$disconnect();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
