import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config();

const URL = process.env.SUPABASE_URL!;
const ANON = process.env.SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function test(label: string, fn: () => Promise<any>) {
  try {
    const res = await fn();
    if (res.error) {
      console.log(`[FAIL] ${label}`);
      console.log(`  error:`, JSON.stringify(res.error, null, 2));
      console.log(`  data:`, res.data);
      console.log(`  status:`, res.status, res.statusText);
    } else {
      console.log(`[OK] ${label}`);
      console.log(`  data:`, res.data);
      console.log(`  count:`, res.count);
    }
    console.log();
  } catch (e: any) {
    console.log(`[EXC] ${label}: ${e.message}\n`);
  }
}

async function main() {
  const anon = createClient(URL, ANON);
  const svc = createClient(URL, SERVICE, { auth: { persistSession: false } });

  console.log("=== ANON: vista v_developments ===\n");
  await test("anon .from('v_developments').select().limit(1)", () =>
    anon.schema("real_estate_hub").from("v_developments").select("*").limit(1)
  );

  console.log("=== SERVICE: vista v_developments ===\n");
  await test("service .from('v_developments').select().limit(1)", () =>
    svc.schema("real_estate_hub").from("v_developments").select("*").limit(1)
  );

  console.log("=== SERVICE: tabla Propyte_zoho_leads ===\n");
  await test("service .from('Propyte_zoho_leads').select().limit(1)", () =>
    svc.schema("real_estate_hub").from("Propyte_zoho_leads").select("*").limit(1)
  );

  console.log("=== ANON: tabla Propyte_zoho_leads (debe fallar) ===\n");
  await test("anon .from('Propyte_zoho_leads').select().limit(1)", () =>
    anon.schema("real_estate_hub").from("Propyte_zoho_leads").select("*").limit(1)
  );

  console.log("=== ANON: tabla Propyte_desarrollos ===\n");
  await test("anon .from('Propyte_desarrollos').select().limit(1)", () =>
    anon.schema("real_estate_hub").from("Propyte_desarrollos").select("*").limit(1)
  );
}

main();
