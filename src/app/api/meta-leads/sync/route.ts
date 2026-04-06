// ============================================================
// API Route: POST /api/meta-leads/sync
// Cron job — pulls Meta leads and compares with CRM
// ============================================================

import { NextResponse } from "next/server"
import { getServerSession } from "@/lib/auth/session"
import { syncMetaLeads } from "@/server/meta-leads"

const ALLOWED_ROLES = ["ADMIN", "DIRECTOR", "GERENTE", "MARKETING"]

export async function POST(request: Request) {
  // Auth: cron secret OR authenticated user with allowed role
  const authHeader = request.headers.get("authorization")
  const cronSecret = process.env.CRON_SECRET

  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    // Cron auth — OK
  } else {
    const session = await getServerSession()
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    const role = (session.user as { role?: string }).role || ""
    if (!ALLOWED_ROLES.includes(role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
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
