// ============================================================
// API Route: GET /api/zoho/sync/cron
// Cron endpoint — ejecuta sync cada 15 minutos
// Diseñado para Vercel Cron o cron externo
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { runSync } from "@/lib/zoho/sync-engine";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const secret =
    process.env.ZOHO_SYNC_CRON_SECRET || process.env.CRON_SECRET;

  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    console.log("[ZOHO CRON] Starting scheduled sync...");
    const result = await runSync();
    const durationMs =
      result.finished_at.getTime() - result.started_at.getTime();

    console.log(
      `[ZOHO CRON] Completed in ${durationMs}ms — ` +
        `To Zoho: ${result.to_zoho.created}c/${result.to_zoho.updated}u/${result.to_zoho.errors}e | ` +
        `From Zoho: ${result.from_zoho.created}c/${result.from_zoho.updated}u/${result.from_zoho.errors}e | ` +
        `API calls: ${result.api_calls_used}`
    );

    return NextResponse.json({
      success: true,
      sync_run_id: result.sync_run_id,
      to_zoho: result.to_zoho,
      from_zoho: result.from_zoho,
      api_calls_used: result.api_calls_used,
      duration_ms: durationMs,
    });
  } catch (err) {
    console.error("[ZOHO CRON] Fatal error:", err);
    return NextResponse.json(
      {
        error: "Cron sync failed",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
