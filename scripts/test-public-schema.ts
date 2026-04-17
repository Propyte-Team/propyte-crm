import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config();

const svc = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

async function main() {
  console.log("=== Test public schema (deberia funcionar) ===\n");

  const r1 = await svc.from("sources").select("*").limit(1);
  console.log("service from('sources'):", r1.error ? `FAIL: ${r1.error.message}` : `OK (${r1.data?.length} rows)`);

  const r2 = await svc.from("properties").select("id, title").limit(1);
  console.log("service from('properties'):", r2.error ? `FAIL: ${r2.error.message}` : `OK (${r2.data?.length} rows)`);

  // Test via fetch directo a PostgREST
  console.log("\n=== Test fetch directo ===\n");
  const url = `${process.env.SUPABASE_URL}/rest/v1/sources?select=id&limit=1`;
  const r3 = await fetch(url, {
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
    },
  });
  console.log(`GET ${url}: HTTP ${r3.status} ${r3.statusText}`);
  console.log("body:", await r3.text());

  // Y en schema real_estate_hub
  console.log("\n=== Test fetch con Accept-Profile ===\n");
  const url2 = `${process.env.SUPABASE_URL}/rest/v1/v_developments?select=*&limit=1`;
  const r4 = await fetch(url2, {
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
      "Accept-Profile": "real_estate_hub",
    },
  });
  console.log(`GET ${url2} (Accept-Profile: real_estate_hub): HTTP ${r4.status} ${r4.statusText}`);
  console.log("body:", await r4.text());
}

main();
