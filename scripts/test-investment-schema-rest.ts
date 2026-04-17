/**
 * Prueba que PostgREST exponga investment_analytics via Accept-Profile header.
 * Sin este schema en "Exposed Schemas" del dashboard, el test fallara.
 */
import { config } from "dotenv";
config();

async function main() {
  const url = process.env.SUPABASE_URL!;
  const anon = process.env.SUPABASE_ANON_KEY!;
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  for (const [label, key] of [["anon", anon], ["service", svc]] as const) {
    console.log(`\n--- ${label} ---`);
    for (const table of ["rental_comparables", "airdna_metrics", "rental_estimates", "development_financials"]) {
      const u = `${url}/rest/v1/${table}?select=*&limit=1`;
      const r = await fetch(u, {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Accept-Profile": "investment_analytics",
        },
      });
      const body = await r.text();
      console.log(`  ${table}: HTTP ${r.status} ${r.statusText}`);
      if (r.status !== 200) {
        console.log(`    body: ${body.slice(0, 200)}`);
      } else {
        const json = JSON.parse(body);
        console.log(`    rows: ${json.length}`);
      }
    }
  }

  // Test count via HEAD
  console.log("\n--- HEAD count (simulando PHP wp_remote_head) ---");
  const u = `${url}/rest/v1/rental_comparables?select=id&active=eq.true&limit=1`;
  const r = await fetch(u, {
    method: "HEAD",
    headers: {
      apikey: anon,
      Authorization: `Bearer ${anon}`,
      "Accept-Profile": "investment_analytics",
      Prefer: "count=exact",
    },
  });
  console.log(`  HTTP ${r.status}`);
  console.log(`  content-range: ${r.headers.get("content-range")}`);
}
main();
