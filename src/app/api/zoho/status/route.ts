// ============================================================
// API Route: GET /api/zoho/status
// Dashboard data: último sync, rate limits, errores recientes
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getZohoClient } from "@/lib/zoho/client";
import { getSupabaseServiceClient } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const secret =
    process.env.ZOHO_SYNC_CRON_SECRET || process.env.CRON_SECRET;

  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const supabase = getSupabaseServiceClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase not configured" },
      { status: 500 }
    );
  }

  try {
    const zoho = getZohoClient();

    // Last sync run
    const { data: lastLog } = await supabase
      .schema("real_estate_hub")
      .from("Propyte_zoho_sync_log")
      .select("sync_run_id, created_at")
      .order("created_at", { ascending: false })
      .limit(1);

    // Counts per entity in ID map
    const { data: mapCounts } = await supabase
      .schema("real_estate_hub")
      .from("Propyte_zoho_id_map")
      .select("entity_type");

    const totalMapped: Record<string, number> = {};
    for (const row of mapCounts || []) {
      const et = row.entity_type as string;
      totalMapped[et] = (totalMapped[et] || 0) + 1;
    }

    // Pending developments (aprobados sin zoho_record_id)
    const { count: pendingCount } = await supabase
      .schema("real_estate_hub")
      .from("Propyte_desarrollos")
      .select("id", { count: "exact", head: true })
      .in("zoho_pipeline_status", ["aprobado", "listo"])
      .is("zoho_record_id", null);

    // Recent errors (last 24h)
    const { data: recentErrors } = await supabase
      .schema("real_estate_hub")
      .from("Propyte_zoho_sync_log")
      .select("*")
      .eq("operation", "error")
      .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .order("created_at", { ascending: false })
      .limit(20);

    // Zoho table counts
    const tables = [
      "Propyte_zoho_leads",
      "Propyte_zoho_contacts",
      "Propyte_zoho_deals",
      "Propyte_zoho_accounts",
    ];

    const tableCounts: Record<string, number> = {};
    for (const table of tables) {
      const { count } = await supabase
        .schema("real_estate_hub")
        .from(table)
        .select("id", { count: "exact", head: true });
      tableCounts[table] = count || 0;
    }

    return NextResponse.json({
      last_sync: lastLog?.[0] || null,
      api_calls_today: zoho.getCallsToday(),
      api_calls_limit: zoho.getDailyLimit(),
      api_calls_remaining: zoho.getRemainingCalls(),
      pending_developments: pendingCount || 0,
      total_mapped: totalMapped,
      table_counts: tableCounts,
      recent_errors: recentErrors || [],
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "Failed to get status",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
