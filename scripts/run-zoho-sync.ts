// Correr sync Zoho manualmente desde CLI
// npx tsx scripts/run-zoho-sync.ts
import "dotenv/config";
import { runSync } from "../src/lib/zoho/sync-engine";
import { createClient } from "@supabase/supabase-js";

async function main() {
  console.log("=== Zoho Sync Manual ===");
  console.log("Inicio:", new Date().toISOString());

  try {
    const result = await runSync();

    console.log("\n=== RESULTADO ===");
    console.log("to_zoho:", JSON.stringify(result.to_zoho));
    console.log("from_zoho:", JSON.stringify(result.from_zoho));
    console.log("api_calls:", result.api_calls_used);
    const dur = (result.finished_at.getTime() - result.started_at.getTime()) / 1000;
    console.log("Duración:", dur, "seg");

    // Verificar conteos post-sync
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (url && key) {
      const supabase = createClient(url, key);
      const tables = ["Propyte_zoho_leads", "Propyte_zoho_contacts", "Propyte_zoho_deals", "Propyte_zoho_accounts"];
      console.log("\n=== CONTEOS POST-SYNC ===");
      for (const table of tables) {
        const { count } = await supabase
          .schema("real_estate_hub")
          .from(table)
          .select("id", { count: "exact", head: true });
        console.log(`  ${table}: ${count}`);
      }
    }
  } catch (e) {
    console.error("ERROR:", e instanceof Error ? e.message : e);
    if (e instanceof Error) console.error(e.stack?.slice(0, 800));
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error("FATAL:", e); process.exit(1); });
