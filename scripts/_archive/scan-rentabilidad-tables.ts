/**
 * Escanea la DB VIEJA buscando tablas relacionadas a rentabilidad:
 * - development_financials
 * - rental_comparables
 * - rental_estimates
 * - airdna_metrics
 * - cualquier otra con nombre sugerente (rent, roi, yield, occupancy, investment)
 *
 * Para cada tabla encontrada reporta: schema, row count, columnas con tipo, FKs.
 * Uso: npx tsx scripts/scan-rentabilidad-tables.ts
 */
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
config();

const OLD_URL = process.env.DATABASE_URL!;
if (!OLD_URL.includes("yjbrynsykkycozeybykj")) {
  console.error("DATABASE_URL no apunta a la DB vieja");
  process.exit(1);
}

const PATTERNS = [
  "development_financials",
  "rental_comparables",
  "rental_estimates",
  "airdna_metrics",
];

const LIKE_PATTERNS = ["%rent%", "%roi%", "%yield%", "%occupancy%", "%investment%", "%airdna%", "%financial%"];

async function main() {
  const db = new PrismaClient({ datasources: { db: { url: OLD_URL } } });
  try {
    console.log("\n=== SCAN TABLAS DE RENTABILIDAD EN DB VIEJA ===\n");

    // 1. Buscar tablas que matcheen los patrones
    console.log("--- 1. Tablas candidatas (por patron de nombre) ---\n");
    const likeClause = LIKE_PATTERNS.map((p) => `table_name ILIKE '${p}'`).join(" OR ");
    const exactClause = PATTERNS.map((p) => `'${p}'`).join(",");
    const candidates = (await db.$queryRawUnsafe(
      `SELECT table_schema, table_name, table_type
       FROM information_schema.tables
       WHERE table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast', 'supabase_migrations', 'extensions', 'graphql', 'graphql_public', 'realtime', 'storage', 'vault', 'net', 'auth', 'pgsodium', 'pgsodium_masks', '_realtime', '_analytics', '_supavisor')
         AND (table_name IN (${exactClause}) OR ${likeClause})
       ORDER BY table_schema, table_name`
    )) as Array<{ table_schema: string; table_name: string; table_type: string }>;

    if (candidates.length === 0) {
      console.log("  (ninguna tabla encontrada)\n");
    }

    for (const c of candidates) {
      console.log(`  ${c.table_schema}.${c.table_name} (${c.table_type})`);
    }

    // 2. Para cada tabla, detalle completo
    for (const c of candidates) {
      if (c.table_type !== "BASE TABLE") continue; // views aparte
      console.log(`\n\n========================================`);
      console.log(`## ${c.table_schema}.${c.table_name}`);
      console.log(`========================================`);

      // row count
      try {
        const count = (await db.$queryRawUnsafe(
          `SELECT COUNT(*)::int AS n FROM "${c.table_schema}"."${c.table_name}"`
        )) as Array<{ n: number }>;
        console.log(`\nRows: ${count[0].n}`);
      } catch (e: any) {
        console.log(`\nRows: ERR (${e.message.split("\n")[0]})`);
      }

      // columnas
      const cols = (await db.$queryRawUnsafe(
        `SELECT
           column_name, data_type, is_nullable, column_default,
           character_maximum_length, numeric_precision, numeric_scale
         FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = $2
         ORDER BY ordinal_position`,
        c.table_schema,
        c.table_name
      )) as Array<{
        column_name: string;
        data_type: string;
        is_nullable: string;
        column_default: string | null;
      }>;
      console.log(`\nColumnas (${cols.length}):`);
      for (const col of cols) {
        const nn = col.is_nullable === "NO" ? " NOT NULL" : "";
        const def = col.column_default ? ` DEFAULT ${col.column_default}` : "";
        console.log(`  ${col.column_name}: ${col.data_type}${nn}${def}`);
      }

      // FKs salientes
      const fks = (await db.$queryRawUnsafe(
        `SELECT
           tc.constraint_name, kcu.column_name,
           ccu.table_schema AS foreign_schema,
           ccu.table_name AS foreign_table,
           ccu.column_name AS foreign_column
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
         JOIN information_schema.constraint_column_usage ccu
           ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
         WHERE tc.constraint_type = 'FOREIGN KEY'
           AND tc.table_schema = $1 AND tc.table_name = $2`,
        c.table_schema,
        c.table_name
      )) as any[];
      if (fks.length > 0) {
        console.log(`\nFKs salientes:`);
        for (const fk of fks) {
          console.log(`  ${fk.column_name} -> ${fk.foreign_schema}.${fk.foreign_table}(${fk.foreign_column})`);
        }
      }

      // muestra de 2 filas (solo columnas interesantes)
      if (c.table_schema !== "public" || !c.table_name.startsWith("pg_")) {
        try {
          const sample = (await db.$queryRawUnsafe(
            `SELECT * FROM "${c.table_schema}"."${c.table_name}" LIMIT 2`
          )) as any[];
          if (sample.length > 0) {
            console.log(`\nMuestra (${sample.length} filas):`);
            for (const row of sample) {
              const compact: Record<string, any> = {};
              for (const [k, v] of Object.entries(row)) {
                if (v === null) continue;
                if (typeof v === "string" && v.length > 80) {
                  compact[k] = v.slice(0, 80) + "...";
                } else if (typeof v === "object") {
                  compact[k] = "<json/object>";
                } else {
                  compact[k] = v;
                }
              }
              console.log("  " + JSON.stringify(compact));
            }
          }
        } catch (e: any) {
          console.log(`\nMuestra: ERR (${e.message.split("\n")[0]})`);
        }
      }
    }

    // 3. Buscar vistas relacionadas
    console.log("\n\n--- 3. Vistas relacionadas ---");
    const views = candidates.filter((c) => c.table_type === "VIEW");
    for (const v of views) {
      console.log(`\n## VIEW ${v.table_schema}.${v.table_name}`);
      try {
        const def = (await db.$queryRawUnsafe(
          `SELECT pg_get_viewdef('"${v.table_schema}"."${v.table_name}"'::regclass, true) as def`
        )) as Array<{ def: string }>;
        console.log(def[0].def.slice(0, 800));
      } catch (e: any) {
        console.log(`  ERR: ${e.message.split("\n")[0]}`);
      }
    }

    // 4. FKs ENTRANTES a estas tablas (algo depende de ellas?)
    console.log("\n\n--- 4. FKs entrantes a tablas de rentabilidad ---\n");
    const tableNames = candidates.filter((c) => c.table_type === "BASE TABLE").map((c) => c.table_name);
    if (tableNames.length > 0) {
      const placeholder = tableNames.map((_, i) => `$${i + 1}`).join(",");
      const incoming = (await db.$queryRawUnsafe(
        `SELECT
           tc.table_schema AS from_schema, tc.table_name AS from_table,
           kcu.column_name AS from_col,
           ccu.table_name AS to_table, ccu.column_name AS to_col
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name
         JOIN information_schema.constraint_column_usage ccu
           ON ccu.constraint_name = tc.constraint_name
         WHERE tc.constraint_type = 'FOREIGN KEY'
           AND ccu.table_name IN (${placeholder})`,
        ...tableNames
      )) as any[];
      if (incoming.length === 0) {
        console.log("  (ninguna tabla depende de estas)");
      } else {
        for (const i of incoming) {
          console.log(`  ${i.from_schema}.${i.from_table}.${i.from_col} -> ${i.to_table}.${i.to_col}`);
        }
      }
    }

    console.log("\n=== FIN SCAN ===\n");
  } finally {
    await db.$disconnect();
  }
}
main().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
