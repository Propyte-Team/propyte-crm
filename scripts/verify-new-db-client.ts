/**
 * Verifica que la NUEVA DB responde correctamente via PostgREST (API)
 * y Storage — que es como el plugin de WP la consume.
 *
 * Checks:
 * 1. real_estate_hub expuesto (anon puede hacer SELECT a las vistas)
 * 2. Service role puede hacer SELECT/INSERT a las tablas
 * 3. Bucket property-images existe
 */

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config();

const URL = process.env.SUPABASE_URL!;
const ANON = process.env.SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function main() {
  console.log("\n=== Verificacion cliente a nueva DB ===\n");

  const results: Array<{ label: string; ok: boolean; detail: string }> = [];

  const anonClient = createClient(URL, ANON);
  const svcClient = createClient(URL, SERVICE, { auth: { persistSession: false } });

  // --- 1. Anon: vistas en real_estate_hub ---
  for (const view of ["v_developers", "v_developments", "v_units"]) {
    try {
      const { data, error, count } = await anonClient
        .schema("real_estate_hub")
        .from(view)
        .select("*", { count: "exact", head: true });
      if (error) {
        results.push({
          label: `ANON .schema('real_estate_hub').from('${view}')`,
          ok: false,
          detail: `${error.message} (code=${error.code})`,
        });
      } else {
        results.push({
          label: `ANON .schema('real_estate_hub').from('${view}')`,
          ok: true,
          detail: `OK (${count ?? 0} rows)`,
        });
      }
    } catch (e: any) {
      results.push({
        label: `ANON .schema('real_estate_hub').from('${view}')`,
        ok: false,
        detail: `Exception: ${e.message}`,
      });
    }
  }

  // --- 2. Service role: SELECT + simulacion de INSERT a tabla (rollback) ---
  for (const table of ["Propyte_desarrolladores", "Propyte_desarrollos", "Propyte_unidades", "Propyte_zoho_leads"]) {
    try {
      const { data, error, count } = await svcClient
        .schema("real_estate_hub")
        .from(table)
        .select("*", { count: "exact", head: true });
      if (error) {
        results.push({
          label: `SERVICE .schema('real_estate_hub').from('${table}')`,
          ok: false,
          detail: `${error.message}`,
        });
      } else {
        results.push({
          label: `SERVICE .schema('real_estate_hub').from('${table}')`,
          ok: true,
          detail: `OK (${count ?? 0} rows)`,
        });
      }
    } catch (e: any) {
      results.push({
        label: `SERVICE .schema('real_estate_hub').from('${table}')`,
        ok: false,
        detail: `Exception: ${e.message}`,
      });
    }
  }

  // --- 3. Storage bucket ---
  try {
    const { data, error } = await svcClient.storage.listBuckets();
    if (error) {
      results.push({ label: "Storage listBuckets", ok: false, detail: error.message });
    } else {
      const bucket = data?.find((b) => b.name === "property-images");
      if (bucket) {
        results.push({
          label: "Bucket property-images existe",
          ok: true,
          detail: `OK (public=${bucket.public})`,
        });
      } else {
        results.push({
          label: "Bucket property-images existe",
          ok: false,
          detail: `No encontrado. Buckets: [${data?.map((b) => b.name).join(", ") || "(ninguno)"}]`,
        });
      }
    }
  } catch (e: any) {
    results.push({ label: "Storage listBuckets", ok: false, detail: `Exception: ${e.message}` });
  }

  // --- Reporte ---
  console.log("Resultados:\n");
  for (const r of results) {
    console.log(`${r.ok ? "[OK]" : "[FAIL]"} ${r.label}`);
    console.log(`      ${r.detail}\n`);
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`=== ${results.length - failed}/${results.length} checks pasaron ===\n`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("Error fatal:", e);
  process.exit(1);
});
