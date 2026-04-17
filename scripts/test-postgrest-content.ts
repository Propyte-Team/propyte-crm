/**
 * Test PostgREST API response — exactly what WordPress will receive.
 * Verifies new content fields (publication_title, description_es, meta_title, etc.)
 *
 * npx tsx scripts/test-postgrest-content.ts
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
    console.error(`  HTTP ${res.status}: ${body.slice(0, 200)}`);
    return null;
  }

  return res.json();
}

async function main() {
  console.log("============================================");
  console.log("TEST PostgREST — Content Fields for WordPress");
  console.log(`URL: ${URL}`);
  console.log("============================================\n");

  // 1. Test v_developments — fetch one WITH content
  console.log("## v_developments — Sample with content\n");
  const devs = await fetchView("v_developments", {
    "published": "eq.true",
    "approved_at": "not.is.null",
    "content_es": "not.is.null",
    "select": "name,publication_title,description_es,description_short_es,meta_title,meta_description,content_h1_es,content_features_es,content_location_es,content_lifestyle_es,amenities,city,images",
    "limit": "1",
  });

  if (devs && devs[0]) {
    const d = devs[0];
    console.log(`  name:              ${(d.name || "NULL").slice(0, 60)}`);
    console.log(`  publication_title: ${(d.publication_title || "NULL").slice(0, 60)}`);
    console.log(`  content_h1_es:     ${(d.content_h1_es || "NULL").slice(0, 80)}`);
    console.log(`  description_es:    ${(d.description_es || "NULL").slice(0, 100)}...`);
    console.log(`  desc_short_es:     ${(d.description_short_es || "NULL").slice(0, 80)}`);
    console.log(`  meta_title:        ${(d.meta_title || "NULL").slice(0, 80)}`);
    console.log(`  meta_description:  ${(d.meta_description || "NULL").slice(0, 80)}`);
    console.log(`  features_es:       ${(d.content_features_es || "NULL").slice(0, 80)}`);
    console.log(`  location_es:       ${(d.content_location_es || "NULL").slice(0, 80)}`);
    console.log(`  lifestyle_es:      ${(d.content_lifestyle_es || "NULL").slice(0, 80)}`);
    console.log(`  amenities:         ${JSON.stringify(d.amenities)?.slice(0, 80)}`);
    console.log(`  images:            ${d.images ? d.images.length + " URLs" : "NULL"}`);
    console.log();

    // Key check: publication_title != name
    if (d.publication_title !== d.name) {
      console.log("  ✓ publication_title is DIFFERENT from name (not the dev name)");
    } else {
      console.log("  ⚠ publication_title is SAME as name (fallback active)");
    }

    // Key check: description is text, not JSON
    if (d.description_es && !d.description_es.startsWith("{")) {
      console.log("  ✓ description_es is clean TEXT (not raw JSON)");
    } else if (d.description_es) {
      console.log("  ✗ description_es is still raw JSON!");
    }
  } else {
    console.log("  No developments with content found or API error");
  }

  // 2. Test v_developments — sample WITHOUT content (fallback)
  console.log("\n## v_developments — Sample without content (fallback)\n");
  const devNoContent = await fetchView("v_developments", {
    "published": "eq.true",
    "approved_at": "not.is.null",
    "content_es": "is.null",
    "select": "name,publication_title,description_es,meta_title,amenities,city",
    "limit": "1",
  });

  if (devNoContent && devNoContent[0]) {
    const d = devNoContent[0];
    console.log(`  name:              ${d.name || "NULL"}`);
    console.log(`  publication_title: ${d.publication_title || "NULL"}`);
    console.log(`  description_es:    ${d.description_es || "NULL"}`);
    console.log(`  meta_title:        ${d.meta_title || "NULL"}`);
    console.log(`  amenities:         ${JSON.stringify(d.amenities)?.slice(0, 80)}`);
    console.log(`  city:              ${d.city || "NULL"}`);
  }

  // 3. Test v_units
  console.log("\n## v_units — Sample with content\n");
  const units = await fetchView("v_units", {
    "content_es": "not.is.null",
    "select": "title,description_es,description_short,meta_title,content_h1_es,content_features_es,development_name,city,price_mxn",
    "limit": "1",
  });

  if (units && units[0]) {
    const u = units[0];
    console.log(`  title:             ${(u.title || "NULL").slice(0, 80)}`);
    console.log(`  content_h1_es:     ${(u.content_h1_es || "NULL").slice(0, 80)}`);
    console.log(`  description_es:    ${(u.description_es || "NULL").slice(0, 100)}...`);
    console.log(`  desc_short:        ${(u.description_short || "NULL").slice(0, 80)}`);
    console.log(`  meta_title:        ${(u.meta_title || "NULL").slice(0, 80)}`);
    console.log(`  features_es:       ${(u.content_features_es || "NULL").slice(0, 80)}`);
    console.log(`  dev_name:          ${u.development_name || "NULL"}`);
    console.log(`  city:              ${u.city || "NULL"}`);
    console.log(`  price_mxn:         ${u.price_mxn || "NULL"}`);

    if (u.description_es && !u.description_es.startsWith("{")) {
      console.log("\n  ✓ description_es is clean TEXT");
    }
  }

  // 4. Columns available (for WordPress developer debugging)
  console.log("\n## Columns available in v_developments\n");
  const colTest = await fetchView("v_developments", {
    "limit": "1",
    "select": "*",
  });
  if (colTest && colTest[0]) {
    const cols = Object.keys(colTest[0]);
    console.log(`  ${cols.length} columns: ${cols.join(", ")}`);
  }

  console.log("\n============================================");
  console.log("OK — PostgREST verification complete");
  console.log("============================================\n");
}

main().catch((err) => {
  console.error("\n[FATAL]", err);
  process.exit(1);
});
