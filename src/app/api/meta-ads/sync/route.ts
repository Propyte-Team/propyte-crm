// ============================================================
// API Route: POST /api/meta-ads/sync
// Cron job — syncs Meta Ads data every 15 minutes
// ============================================================

import { NextResponse } from "next/server"
import { syncMetaInsights } from "@/server/meta-ads"

export async function POST(request: Request) {
  // Verify cron secret (Vercel sets this automatically)
  const authHeader = request.headers.get("authorization")
  const cronSecret = process.env.CRON_SECRET

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const results = await syncMetaInsights()
    return NextResponse.json({
      ok: true,
      syncedAt: new Date().toISOString(),
      accounts: results,
    })
  } catch (error) {
    console.error("[Meta Sync] Cron error:", error)
    return NextResponse.json(
      { error: "Sync failed", message: String(error) },
      { status: 500 }
    )
  }
}

// Also support GET for manual testing
export async function GET(request: Request) {
  return POST(request)
}
