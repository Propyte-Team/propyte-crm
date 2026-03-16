// ============================================================
// Supabase client for CRM → propyte-web publishing
// Uses service role to bypass RLS
// ============================================================

import { createClient } from "@supabase/supabase-js";

let client: ReturnType<typeof createClient> | null = null;

export function getSupabaseServiceClient() {
  if (client) return client;

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.warn("[SUPABASE] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — web publishing disabled");
    return null;
  }

  client = createClient(url, key);
  return client;
}
