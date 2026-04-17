// Verificar si PostgREST esta realmente corriendo o crasheado
async function main() {
  const url = process.env.SUPABASE_URL!;
  
  // 1. Root endpoint
  const r1 = await fetch(`${url}/rest/v1/`);
  console.log("GET /rest/v1/:", r1.status, r1.statusText);
  console.log("headers:", Object.fromEntries(r1.headers.entries()));
  console.log("body:", (await r1.text()).slice(0, 500));
  console.log();
  
  // 2. Con apikey header
  const r2 = await fetch(`${url}/rest/v1/`, {
    headers: { apikey: process.env.SUPABASE_ANON_KEY! }
  });
  console.log("GET /rest/v1/ (with apikey):", r2.status, r2.statusText);
  console.log("body:", (await r2.text()).slice(0, 500));
}

import { config } from "dotenv";
config();
main();
