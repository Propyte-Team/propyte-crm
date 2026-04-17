import { config } from "dotenv";
config();
async function main() {
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/`, {
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
    }
  });
  console.log("status:", r.status);
  console.log("body:", (await r.text()).slice(0, 2000));
}
main();
