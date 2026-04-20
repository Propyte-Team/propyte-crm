/**
 * Diagnose: why do unit development_ids NOT match development IDs?
 *
 * npx tsx scripts/diagnose-id-mismatch.ts
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
  console.log("DIAGNÓSTICO: ID Mismatch — Units vs Developments");
  console.log("=".repeat(60));

  // Get ALL developments (not just approved/published)
  console.log("\n## Todos los desarrollos en Supabase\n");

  const allDevs = await fetchView("v_developments", {
    select: "id,name,published,approved_at,zoho_pipeline_status,city",
    order: "name.asc",
    limit: "2000",
  });

  if (!allDevs) return;
  console.log(`  Total desarrollos (sin filtros): ${allDevs.length}`);

  const allDevIds = new Set(allDevs.map((d: any) => d.id));
  const approvedDevIds = new Set(
    allDevs
      .filter((d: any) => {
        const s = (d.zoho_pipeline_status || "").toLowerCase().trim();
        return d.published && d.approved_at && ["aprobado", "listo"].includes(s);
      })
      .map((d: any) => d.id)
  );

  console.log(`  Con published+approved+status: ${approvedDevIds.size}`);

  // Get approved units
  console.log("\n## Unidades aprobadas\n");

  const units = await fetchView("v_units", {
    approved_at: "not.is.null",
    zoho_pipeline_status: "not.is.null",
    select: "id,title,development_id,development_name,zoho_pipeline_status,price_mxn,city",
    limit: "2000",
  });

  if (!units) return;
  console.log(`  Total unidades aprobadas: ${units.length}`);

  // Analyze development_ids
  const unitDevIds = new Set(units.map((u: any) => u.development_id).filter(Boolean));
  console.log(`  development_id únicos en unidades: ${unitDevIds.size}`);

  // Check matches
  let matchAllDevs = 0;
  let matchApproved = 0;
  let noMatch = 0;
  const noMatchIds = new Set<string>();

  for (const devId of unitDevIds) {
    if (approvedDevIds.has(devId)) {
      matchApproved++;
    } else if (allDevIds.has(devId)) {
      matchAllDevs++;
    } else {
      noMatch++;
      noMatchIds.add(devId);
    }
  }

  console.log(`\n  Development IDs de unidades que:`);
  console.log(`    ✅ Matchean con desarrollo aprobado+publicado: ${matchApproved}`);
  console.log(`    ⚠️  Matchean pero desarrollo NO aprobado/publicado: ${matchAllDevs}`);
  console.log(`    ❌ NO existen en v_developments: ${noMatch}`);

  // Show what the development_ids point to
  if (noMatch > 0) {
    console.log(`\n## IDs que NO existen en v_developments (primeros 10):`);
    let shown = 0;
    for (const id of noMatchIds) {
      const sample = units.find((u: any) => u.development_id === id);
      console.log(`  id=${id} | unit_title=${sample?.title?.slice(0, 40)} | city=${sample?.city}`);
      if (++shown >= 10) break;
    }

    // Check if these IDs exist in the RAW table (not the view)
    console.log("\n  Verificando si existen en tabla raw Propyte_desarrollos...");
    for (const id of Array.from(noMatchIds).slice(0, 3)) {
      const raw = await fetchView("Propyte_desarrollos", {
        id: `eq.${id}`,
        select: "id,nombre_desarrollo,ext_publicado,approved_at,zoho_pipeline_status,ciudad,deleted_at",
      });
      if (raw && raw.length > 0) {
        const r = raw[0];
        console.log(`  ENCONTRADO en tabla: ${r.nombre_desarrollo} | publicado=${r.ext_publicado} | approved=${r.approved_at} | status=${r.zoho_pipeline_status} | city=${r.ciudad} | deleted=${r.deleted_at}`);
      } else {
        console.log(`  NO encontrado en tabla raw para id=${id}`);
      }
    }
  }

  // Also check: do the units have development_name from the JOIN?
  console.log("\n## ¿Las unidades tienen development_name del LEFT JOIN?\n");
  const withDevName = units.filter((u: any) => u.development_name);
  const withoutDevName = units.filter((u: any) => !u.development_name);
  console.log(`  Con development_name: ${withDevName.length}`);
  console.log(`  Sin development_name (JOIN failed): ${withoutDevName.length}`);

  if (withDevName.length > 0) {
    console.log("\n  Muestra con dev_name:");
    withDevName.slice(0, 3).forEach((u: any) => {
      console.log(`    ${u.title?.slice(0, 40)} → dev: ${u.development_name} | dev_id: ${u.development_id}`);
    });
  }

  // Final: cross-reference a specific unit's development_id with developments table
  if (units.length > 0) {
    const sampleUnit = withDevName[0] || units[0];
    console.log(`\n## Cross-check: Unidad "${sampleUnit.title?.slice(0, 40)}"`);
    console.log(`  development_id: ${sampleUnit.development_id}`);
    console.log(`  development_name (from JOIN): ${sampleUnit.development_name || "NULL"}`);

    // Check if this ID is in the approved developments
    const matchingDev = allDevs.find((d: any) => d.id === sampleUnit.development_id);
    if (matchingDev) {
      console.log(`  Found in v_developments: ${matchingDev.name} | published=${matchingDev.published} | approved=${matchingDev.approved_at} | status=${matchingDev.zoho_pipeline_status}`);
    } else {
      console.log(`  ❌ NOT found in v_developments at all!`);

      // Check if views use different schemas or filters
      console.log("\n  Checking raw table...");
      const rawDev = await fetchView("Propyte_desarrollos", {
        id: `eq.${sampleUnit.development_id}`,
        select: "id,nombre_desarrollo,ext_publicado,approved_at,zoho_pipeline_status,ciudad,deleted_at",
      });
      if (rawDev && rawDev[0]) {
        const r = rawDev[0];
        console.log(`  ✅ Found in Propyte_desarrollos (raw table):`);
        console.log(`     nombre: ${r.nombre_desarrollo}`);
        console.log(`     ext_publicado: ${r.ext_publicado}`);
        console.log(`     approved_at: ${r.approved_at}`);
        console.log(`     zoho_pipeline_status: ${r.zoho_pipeline_status}`);
        console.log(`     ciudad: ${r.ciudad}`);
        console.log(`     deleted_at: ${r.deleted_at}`);

        if (!r.ext_publicado) console.log("     → ❌ NOT published (ext_publicado=false). v_developments requires published=true!");
        if (!r.approved_at) console.log("     → ❌ NOT approved");
        if (!r.ciudad) console.log("     → ❌ No city");
      } else {
        console.log(`  ❌ NOT in Propyte_desarrollos either — orphan FK!`);
      }
    }
  }
}

main().catch(console.error);