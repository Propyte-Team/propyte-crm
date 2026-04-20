/**
 * Diagnose why units are NOT syncing to WordPress.
 * Simulates the exact same queries + filters that class-propyte-sync-manager.php uses.
 *
 * npx tsx scripts/diagnose-unit-sync.ts
 */

import { config } from "dotenv";
config();

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!URL || !KEY) {
  console.error("[FATAL] SUPABASE_URL or SUPABASE_ANON_KEY not set");
  process.exit(1);
}

async function fetchView(view: string, params: Record<string, string> = {}) {
  const query = new URLSearchParams(params).toString();
  const url = `${URL}/rest/v1/${view}${query ? "?" + query : ""}`;

  const res = await fetch(url, {
    headers: {
      apikey: KEY!,
      Authorization: `Bearer ${KEY}`,
      "Accept-Profile": "real_estate_hub",
    },
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`  HTTP ${res.status}: ${body.slice(0, 300)}`);
    return null;
  }

  return res.json();
}

async function main() {
  console.log("=".repeat(60));
  console.log("DIAGNÓSTICO: ¿Por qué las unidades no sincronizan a WP?");
  console.log(`Supabase URL: ${URL}`);
  console.log("=".repeat(60));

  // ── STEP 1: Check developments (same query as WP sync manager) ──
  console.log("\n## PASO 1: Desarrollos aprobados (lo que WP pide)\n");

  const devs = await fetchView("v_developments", {
    published: "eq.true",
    city: "not.is.null",
    approved_at: "not.is.null",
    zoho_pipeline_status: "not.is.null",
    select: "id,name,city,zoho_pipeline_status,published,approved_at",
    order: "name.asc",
    limit: "2000",
  });

  if (!devs) {
    console.error("  ❌ No se pudo obtener v_developments — revisa credenciales/PostgREST");
    return;
  }

  console.log(`  Total retornados por PostgREST: ${devs.length}`);

  // Apply same PHP filter: status must be 'aprobado' or 'listo' (case-insensitive)
  const approvedDevs = devs.filter((d: any) => {
    const status = (d.zoho_pipeline_status || "").toLowerCase().trim();
    return ["aprobado", "listo"].includes(status);
  });

  console.log(`  Pasan filtro pipeline_status (aprobado/listo): ${approvedDevs.length}`);

  if (approvedDevs.length === 0) {
    console.log("\n  ❌ PROBLEMA: No hay desarrollos con status 'aprobado' o 'listo'.");
    console.log("  Las unidades NO se sincronizan si no hay desarrollos en WP.");

    // Show what statuses exist
    const statuses: Record<string, number> = {};
    devs.forEach((d: any) => {
      const s = d.zoho_pipeline_status || "NULL";
      statuses[s] = (statuses[s] || 0) + 1;
    });
    console.log("\n  Statuses existentes:");
    for (const [s, c] of Object.entries(statuses)) {
      console.log(`    ${s}: ${c}`);
    }
    return;
  }

  // These are the IDs that WordPress would have as $wp_dev_ids
  const wpDevIds = approvedDevs.map((d: any) => d.id);
  console.log(`  → Estos ${wpDevIds.length} IDs serían $wp_dev_ids en WP`);

  // Show first 5
  console.log("  Muestra (primeros 5):");
  approvedDevs.slice(0, 5).forEach((d: any) => {
    console.log(`    ${d.name} | ${d.city} | status=${d.zoho_pipeline_status} | id=${d.id}`);
  });

  // ── STEP 2: Check units (same query as WP sync manager) ──
  console.log("\n## PASO 2: Unidades — query PostgREST (mismo que WP)\n");

  const units = await fetchView("v_units", {
    approved_at: "not.is.null",
    zoho_pipeline_status: "not.is.null",
    select:
      "id,title,development_id,development_name,zoho_pipeline_status,price_mxn,price_usd,approved_at,approved_by,bedrooms,area_m2,city",
    order: "updated_at.asc",
    limit: "2000",
  });

  if (!units) {
    console.error("  ❌ No se pudo obtener v_units — revisa PostgREST/Exposed Schemas");
    return;
  }

  console.log(`  Total retornados por PostgREST (approved_at + status NOT NULL): ${units.length}`);

  if (units.length === 0) {
    console.log("\n  ❌ PROBLEMA: PostgREST devuelve 0 unidades con approved_at NOT NULL");
    console.log("  Esto significa que las unidades NO están aprobadas en Supabase.");

    // Check total units without filters
    const allUnits = await fetchView("v_units", {
      select: "id,approved_at,zoho_pipeline_status",
      limit: "5",
    });
    console.log(`\n  Total unidades sin filtros (muestra): ${allUnits?.length ?? 0}`);
    if (allUnits && allUnits[0]) {
      console.log(`  Ejemplo: approved_at=${allUnits[0].approved_at}, status=${allUnits[0].zoho_pipeline_status}`);
    }
    return;
  }

  // ── STEP 3: Apply WordPress quality filters ──
  console.log("\n## PASO 3: Filtros de calidad WordPress (PHP simulado)\n");

  let failStatus = 0;
  let failNoDev = 0;
  let failDevNotInWP = 0;
  let failNoPrice = 0;
  let passed = 0;

  const failedDevIds = new Set<string>();

  for (const u of units) {
    const status = (u.zoho_pipeline_status || "").toLowerCase().trim();
    if (!["aprobado", "listo"].includes(status)) {
      failStatus++;
      continue;
    }

    if (!u.development_id) {
      failNoDev++;
      continue;
    }

    if (!wpDevIds.includes(u.development_id)) {
      failDevNotInWP++;
      failedDevIds.add(u.development_id);
      continue;
    }

    const hasPrice =
      (u.price_mxn && Number(u.price_mxn) > 0) ||
      (u.price_usd && Number(u.price_usd) > 0);
    if (!hasPrice) {
      failNoPrice++;
      continue;
    }

    passed++;
  }

  console.log(`  Total unidades analizadas: ${units.length}`);
  console.log(`  ──────────────────────────────────`);
  console.log(`  ❌ Fallo status (no aprobado/listo):  ${failStatus}`);
  console.log(`  ❌ Fallo sin development_id:           ${failNoDev}`);
  console.log(`  ❌ Fallo dev_id no está en WP:         ${failDevNotInWP}`);
  console.log(`  ❌ Fallo sin precio (MXN ni USD):      ${failNoPrice}`);
  console.log(`  ──────────────────────────────────`);
  console.log(`  ✅ PASAN todos los filtros:            ${passed}`);

  if (failDevNotInWP > 0) {
    console.log(`\n  ⚠️ ${failedDevIds.size} development_id(s) de unidades NO coinciden con desarrollos aprobados en WP.`);
    console.log("  Esto puede ocurrir si:");
    console.log("  - El desarrollo no pasó quality check (sin imagen real o sin city)");
    console.log("  - El desarrollo no está published=true");
    console.log("  - Bug: development_id de la unidad no matchea ningún id de v_developments");
  }

  if (passed === 0) {
    console.log("\n  ❌ RESULTADO: NINGUNA unidad pasa todos los filtros.");
    console.log("  Esto explica por qué WordPress muestra 0 propiedades.");
  } else {
    console.log(`\n  ✅ RESULTADO: ${passed} unidades DEBERÍAN sincronizar a WP.`);
    console.log("  Si WP muestra 0, el problema está en WordPress, no en Supabase.");
  }

  // ── STEP 4: Show samples of passing/failing units ──
  if (passed > 0) {
    console.log("\n## Muestra de unidades que PASAN:");
    let shown = 0;
    for (const u of units) {
      const status = (u.zoho_pipeline_status || "").toLowerCase().trim();
      if (!["aprobado", "listo"].includes(status)) continue;
      if (!u.development_id || !wpDevIds.includes(u.development_id)) continue;
      const hasPrice =
        (u.price_mxn && Number(u.price_mxn) > 0) ||
        (u.price_usd && Number(u.price_usd) > 0);
      if (!hasPrice) continue;

      console.log(
        `  ${u.title?.slice(0, 50)} | dev=${u.development_name?.slice(0, 30)} | $${u.price_mxn || u.price_usd} | ${u.city}`
      );
      if (++shown >= 5) break;
    }
  }

  // Show sample of units that fail each check
  if (failNoPrice > 0) {
    console.log("\n## Muestra unidades SIN precio:");
    let shown = 0;
    for (const u of units) {
      const status = (u.zoho_pipeline_status || "").toLowerCase().trim();
      if (!["aprobado", "listo"].includes(status)) continue;
      if (!u.development_id || !wpDevIds.includes(u.development_id)) continue;
      const hasPrice =
        (u.price_mxn && Number(u.price_mxn) > 0) ||
        (u.price_usd && Number(u.price_usd) > 0);
      if (hasPrice) continue;
      console.log(
        `  ${u.title?.slice(0, 50)} | price_mxn=${u.price_mxn} | price_usd=${u.price_usd}`
      );
      if (++shown >= 5) break;
    }
  }

  if (failNoDev > 0) {
    console.log("\n## Muestra unidades SIN development_id (sueltas):");
    let shown = 0;
    for (const u of units) {
      if (u.development_id) continue;
      console.log(`  ${u.title?.slice(0, 50)} | id=${u.id}`);
      if (++shown >= 5) break;
    }
  }
}

main().catch(console.error);