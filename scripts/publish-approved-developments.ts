/**
 * Publish approved developments that have approved units.
 * Sets ext_publicado=true for developments that are already approved
 * but were not yet marked as published.
 *
 * Also reports which ones would fail WordPress quality checks.
 *
 * npx tsx scripts/publish-approved-developments.ts
 * npx tsx scripts/publish-approved-developments.ts --dry-run
 */

import { config } from "dotenv";
config();

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !KEY) {
  console.error("[FATAL] SUPABASE_URL or SUPABASE_ANON_KEY not set");
  process.exit(1);
}
if (!SERVICE_KEY) {
  console.error("[FATAL] SUPABASE_SERVICE_ROLE_KEY not set — needed for writes");
  process.exit(1);
}

const isDryRun = process.argv.includes("--dry-run");

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

async function updateTable(
  table: string,
  params: Record<string, string>,
  body: Record<string, any>
) {
  const query = new URLSearchParams(params).toString();
  const url = `${URL}/rest/v1/${table}${query ? "?" + query : ""}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      apikey: SERVICE_KEY!,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Profile": "real_estate_hub",
      "Content-Type": "application/json",
      Prefer: "return=representation,count=exact",
    },
    body: JSON.stringify(body),
  });
  const countHeader = res.headers.get("content-range");
  const respBody = await res.json();
  return { status: res.status, count: countHeader, data: respBody };
}

async function main() {
  console.log("=".repeat(60));
  console.log(isDryRun ? "DRY RUN — no changes" : "LIVE RUN — will update Supabase");
  console.log("Publish approved developments that have approved units");
  console.log("=".repeat(60));

  // 1. Get all approved units grouped by development
  const units = await fetchView("v_units", {
    approved_at: "not.is.null",
    zoho_pipeline_status: "not.is.null",
    select: "id,development_id,development_name",
    limit: "2000",
  });
  if (!units) return;

  const devIdSet = new Set<string>();
  units.forEach((u: any) => {
    if (u.development_id) devIdSet.add(u.development_id);
  });

  console.log(`\n  Unidades aprobadas: ${units.length}`);
  console.log(`  Desarrollos únicos referenciados: ${devIdSet.size}`);

  // 2. Get those developments from the raw table
  const devIds = Array.from(devIdSet);
  let needPublish: any[] = [];
  let alreadyPublished = 0;

  // Fetch in batches of 50 (PostgREST IN filter)
  for (let i = 0; i < devIds.length; i += 50) {
    const batch = devIds.slice(i, i + 50);
    const inFilter = `in.(${batch.join(",")})`;
    const devs = await fetchView("Propyte_desarrollos", {
      id: inFilter,
      select:
        "id,nombre_desarrollo,ext_publicado,approved_at,zoho_pipeline_status,ciudad,fotos_desarrollo,deleted_at",
    });
    if (!devs) continue;

    for (const d of devs) {
      if (d.ext_publicado) {
        alreadyPublished++;
        continue;
      }
      needPublish.push(d);
    }
  }

  console.log(`\n  Ya publicados (ext_publicado=true): ${alreadyPublished}`);
  console.log(`  Necesitan publicar: ${needPublish.length}`);

  // 3. Check WordPress quality filter
  const passQuality: string[] = [];
  const failQuality: { id: string; name: string; reasons: string[] }[] = [];

  for (const d of needPublish) {
    const reasons: string[] = [];
    if (!d.nombre_desarrollo) reasons.push("sin nombre");
    if (!d.ciudad) reasons.push("sin ciudad");

    const images = d.fotos_desarrollo;
    if (!Array.isArray(images) || images.length === 0) {
      reasons.push("sin imágenes");
    } else {
      const hasReal = images.some(
        (img: string) => img && !img.includes("unsplash.com")
      );
      if (!hasReal) reasons.push("solo imágenes unsplash");
    }

    if (reasons.length === 0) {
      passQuality.push(d.id);
    } else {
      failQuality.push({
        id: d.id,
        name: d.nombre_desarrollo || "sin nombre",
        reasons,
      });
    }
  }

  console.log(`\n  Pasan quality check WP: ${passQuality.length}`);
  console.log(`  NO pasan quality check: ${failQuality.length}`);

  if (failQuality.length > 0) {
    console.log("\n  Desarrollos que NO pasarán quality check:");
    failQuality.slice(0, 15).forEach((f) => {
      console.log(`    ❌ ${f.name} — ${f.reasons.join(", ")}`);
    });
    if (failQuality.length > 15) {
      console.log(`    ... y ${failQuality.length - 15} más`);
    }
  }

  // Count units that will be unblocked
  const unitsUnblocked = units.filter((u: any) =>
    passQuality.includes(u.development_id)
  ).length;

  console.log(`\n  Unidades que se desbloquearán: ${unitsUnblocked} de ${units.length}`);

  if (passQuality.length === 0) {
    console.log("\n  ⚠️ Ningún desarrollo nuevo pasa quality. Nada que actualizar.");

    // Show all quality failures
    if (failQuality.length > 0) {
      const noCity = failQuality.filter((f) =>
        f.reasons.includes("sin ciudad")
      ).length;
      const noImg = failQuality.filter(
        (f) =>
          f.reasons.includes("sin imágenes") ||
          f.reasons.includes("solo imágenes unsplash")
      ).length;
      const noName = failQuality.filter((f) =>
        f.reasons.includes("sin nombre")
      ).length;
      console.log(`\n  Resumen fallos quality:`);
      console.log(`    Sin ciudad: ${noCity}`);
      console.log(`    Sin imágenes reales: ${noImg}`);
      console.log(`    Sin nombre: ${noName}`);
    }
    return;
  }

  // 4. Update: set ext_publicado=true
  if (isDryRun) {
    console.log(`\n  [DRY RUN] Habría publicado ${passQuality.length} desarrollos.`);
    console.log("  Ejecuta sin --dry-run para aplicar.");
    return;
  }

  console.log(`\n  Publicando ${passQuality.length} desarrollos...`);

  // Update in batches
  let updated = 0;
  for (let i = 0; i < passQuality.length; i += 50) {
    const batch = passQuality.slice(i, i + 50);
    const inFilter = `in.(${batch.join(",")})`;
    const result = await updateTable(
      "Propyte_desarrollos",
      { id: inFilter },
      { ext_publicado: true, updated_at: new Date().toISOString() }
    );

    if (result.status >= 200 && result.status < 300) {
      const count = Array.isArray(result.data) ? result.data.length : 0;
      updated += count;
      console.log(`    Batch ${Math.floor(i / 50) + 1}: ${count} actualizados`);
    } else {
      console.error(`    Batch ${Math.floor(i / 50) + 1} ERROR: HTTP ${result.status}`);
      console.error(`    ${JSON.stringify(result.data).slice(0, 300)}`);
    }
  }

  console.log(`\n  ✅ ${updated} desarrollos publicados (ext_publicado=true)`);
  console.log(`  → ${unitsUnblocked} unidades desbloqueadas para el próximo sync de WP`);
  console.log("\n  Siguiente paso: Correr Sync Manual en WP Admin → Propyte → Configuración → Sync");
}

main().catch(console.error);