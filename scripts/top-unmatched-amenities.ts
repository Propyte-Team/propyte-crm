/**
 * Lista las top amenities mas comunes en public.properties.raw_data.amenities
 * que NO matchean con el dictionary de aggregators.ts.
 *
 * Sirve para expandir el AMENITY_MAP con patterns que cubran mas casos reales.
 */
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { AMENITY_MAP } from "../src/robots/01-classifier/aggregators";

// Misma normalizacion que aggregateAmenities usa internamente
function normalizeAmenity(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}
config();

const URL = `postgresql://postgres.oaijxdpevakashxshhvm:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD!)}@aws-1-us-east-1.pooler.supabase.com:5432/postgres`;

async function main() {
  const db = new PrismaClient({ datasources: { db: { url: URL } } });
  try {
    console.log("## Top 50 amenities unmatched en public.properties.raw_data.amenities\n");

    // Query todas las amenities de todas las properties (filtradas por status)
    const rows = (await db.$queryRawUnsafe(
      `SELECT jsonb_array_elements_text(p.raw_data->'amenities') as amenity,
              COUNT(*)::int as n
       FROM public.properties p
       WHERE p.status IN ('review', 'published')
         AND jsonb_typeof(p.raw_data->'amenities') = 'array'
       GROUP BY amenity
       ORDER BY n DESC`
    )) as Array<{ amenity: string; n: number }>;

    console.log(`Total amenities unicos en public.*: ${rows.length}\n`);

    const matched: Array<{ amenity: string; n: number; target: string }> = [];
    const unmatched: Array<{ amenity: string; n: number }> = [];

    for (const r of rows) {
      const normalized = normalizeAmenity(r.amenity);
      const match = AMENITY_MAP.find((m) => m.pattern.test(normalized));
      if (match) {
        matched.push({ ...r, target: match.target });
      } else {
        unmatched.push(r);
      }
    }

    console.log(`  Matched: ${matched.length} amenities distintas (${matched.reduce((s, m) => s + m.n, 0)} occurrences)`);
    console.log(`  Unmatched: ${unmatched.length} amenities distintas (${unmatched.reduce((s, m) => s + m.n, 0)} occurrences)`);

    console.log("\n## Top 50 UNMATCHED\n");
    for (const r of unmatched.slice(0, 50)) {
      console.log(`  [${r.n}] "${r.amenity}"`);
    }

    console.log("\n## Muestra de MATCHED (para verificar no hay falsos positivos)\n");
    for (const r of matched.slice(0, 20)) {
      console.log(`  [${r.n}] "${r.amenity}" -> ${r.target}`);
    }
  } finally {
    await db.$disconnect();
  }
}
main();
