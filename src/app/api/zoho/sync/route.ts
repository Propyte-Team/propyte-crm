// ============================================================
// API Route: POST /api/zoho/sync
// Trigger manual de sync Supabase ↔ Zoho CRM
// Protegido por API key
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { runSync } from "@/lib/zoho/sync-engine";

export async function POST(request: NextRequest) {
  // Auth: CRON_SECRET o ZOHO_SYNC_CRON_SECRET
  const authHeader = request.headers.get("authorization");
  const secret =
    process.env.ZOHO_SYNC_CRON_SECRET || process.env.CRON_SECRET;

  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    console.log("[ZOHO SYNC] Manual sync triggered");
    const result = await runSync();

    return NextResponse.json({
      success: true,
      result,
      duration_ms: result.finished_at.getTime() - result.started_at.getTime(),
    });
  } catch (err) {
    console.error("[ZOHO SYNC] Error:", err);
    return NextResponse.json(
      {
        error: "Sync failed",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
