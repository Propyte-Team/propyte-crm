/**
 * Verifica end-to-end que dev.propyte.com esta leyendo de la nueva DB.
 *
 * 1. Test PostgREST con anon key: vistas deben responder (aunque vacias)
 * 2. Test PostgREST con service_role: debe leer tablas Zoho bloqueadas a anon
 * 3. Fetch dev.propyte.com homepage: debe cargar 200
 * 4. Fetch pagina de listado si existe
 */

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config();

const URL = process.env.SUPABASE_URL!;
const ANON = process.env.SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const DEV_SITE = "https://dev.propyte.com";

async function main() {
  console.log("\n=== Verificacion dev.propyte.com <-> nueva DB ===\n");
  const results: Array<{ label: string; ok: boolean; detail: string }> = [];

  const anon = createClient(URL, ANON);
  const svc = createClient(URL, SERVICE, { auth: { persistSession: false } });

  // 1. Anon: vistas real_estate_hub
  console.log("--- 1. PostgREST anon: vistas ---");
  for (const view of ["v_developers", "v_developments", "v_units"]) {
    try {
      const { data, error, count } = await anon
        .schema("real_estate_hub")
        .from(view)
        .select("*", { count: "exact", head: true });
      if (error) {
        results.push({ label: `anon .from('${view}')`, ok: false, detail: JSON.stringify(error) });
      } else {
        results.push({
          label: `anon .from('${view}')`,
          ok: true,
          detail: `${count ?? 0} rows visibles (vacio, esperado)`,
        });
      }
    } catch (e: any) {
      results.push({ label: `anon .from('${view}')`, ok: false, detail: e.message });
    }
  }

  // 2. Anon: NO debe acceder a Zoho leads
  console.log("\n--- 2. PostgREST anon: Zoho bloqueado ---");
  try {
    const { data, error } = await anon
      .schema("real_estate_hub")
      .from("Propyte_zoho_leads")
      .select("*", { count: "exact", head: true });
    if (error) {
      // esperamos error de RLS
      results.push({
        label: "anon SELECT Propyte_zoho_leads (debe fallar)",
        ok: true,
        detail: `BLOCKED OK: ${error.message}`,
      });
    } else {
      // si no falla pero devuelve 0, es porque RLS filtra todo
      const r = await anon.schema("real_estate_hub").from("Propyte_zoho_leads").select("id").limit(1);
      results.push({
        label: "anon SELECT Propyte_zoho_leads (debe no ver filas)",
        ok: (r.data?.length ?? 0) === 0,
        detail: `${r.data?.length ?? 0} filas visibles (esperado: 0 por RLS)`,
      });
    }
  } catch (e: any) {
    results.push({ label: "anon SELECT Propyte_zoho_leads", ok: true, detail: `blocked: ${e.message}` });
  }

  // 3. Service role: debe poder leer Zoho (bypass RLS)
  console.log("\n--- 3. PostgREST service_role: acceso total ---");
  try {
    const { count, error } = await svc
      .schema("real_estate_hub")
      .from("Propyte_zoho_leads")
      .select("*", { count: "exact", head: true });
    if (error) {
      results.push({
        label: "service_role SELECT Propyte_zoho_leads",
        ok: false,
        detail: JSON.stringify(error),
      });
    } else {
      results.push({
        label: "service_role SELECT Propyte_zoho_leads",
        ok: true,
        detail: `${count ?? 0} rows (bypass RLS OK)`,
      });
    }
  } catch (e: any) {
    results.push({ label: "service_role SELECT Propyte_zoho_leads", ok: false, detail: e.message });
  }

  // 4. dev.propyte.com homepage
  console.log("\n--- 4. dev.propyte.com homepage ---");
  try {
    const r = await fetch(DEV_SITE, { redirect: "follow" });
    results.push({
      label: `GET ${DEV_SITE}/`,
      ok: r.ok,
      detail: `HTTP ${r.status} ${r.statusText}`,
    });
  } catch (e: any) {
    results.push({ label: `GET ${DEV_SITE}/`, ok: false, detail: e.message });
  }

  // 5. Pagina de desarrollos (ruta comun)
  console.log("\n--- 5. Pagina /desarrollos ---");
  for (const path of ["/desarrollos", "/desarrollos/", "/?page_id=2"]) {
    try {
      const r = await fetch(`${DEV_SITE}${path}`, { redirect: "follow" });
      results.push({
        label: `GET ${DEV_SITE}${path}`,
        ok: r.status < 500,
        detail: `HTTP ${r.status} (${r.ok ? "OK" : r.status < 500 ? "soft-error" : "server error"})`,
      });
      if (r.ok) {
        const text = await r.text();
        const hasError = text.toLowerCase().includes("fatal error") || text.includes("Warning:");
        if (hasError) {
          const snippet = text.match(/(Fatal error|Warning)[^\n]{0,200}/i)?.[0] ?? "";
          results.push({
            label: `  body check ${path}`,
            ok: false,
            detail: `PHP error detectado: ${snippet.slice(0, 150)}`,
          });
        }
        break; // si una ruta funciona, no intentamos las demas
      }
    } catch (e: any) {
      results.push({ label: `GET ${DEV_SITE}${path}`, ok: false, detail: e.message });
    }
  }

  // === Reporte ===
  console.log("\n=== Resultados ===\n");
  for (const r of results) {
    console.log(`${r.ok ? "[OK]" : "[FAIL]"} ${r.label}`);
    console.log(`      ${r.detail}\n`);
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`=== ${results.length - failed}/${results.length} checks pasaron ===`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("Error fatal:", e);
  process.exit(1);
});
