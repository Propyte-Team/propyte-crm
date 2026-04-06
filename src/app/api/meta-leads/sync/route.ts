// ============================================================
// API Route: POST /api/meta-leads/sync
// Cron job — pulls Meta leads and compares with CRM
// ============================================================

import { NextResponse } from "next/server"
import { syncMetaLeads } from "@/server/meta-leads"

export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization")
  const cronSecret = process.env.CRON_SECRET

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const results = await syncMetaLeads()
    return NextResponse.json({
      ok: true,
      syncedAt: new Date().toISOString(),
      ...results,
    })
  } catch (error) {
    console.error("[Meta Leads Sync] Error:", error)
    return NextResponse.json(
      { error: "Sync failed", message: String(error) },
      { status: 500 }
    )
  }
}

export async function GET(request: Request) {
  return POST(request)
}
