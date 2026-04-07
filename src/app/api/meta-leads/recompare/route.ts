// ============================================================
// API Route: POST /api/meta-leads/recompare
// Syncs Zoho leads to Supabase, then re-runs comparison
// ============================================================

import { NextResponse } from "next/server"
import { getServerSession } from "@/lib/auth/session"
import { syncZohoThenCompare } from "@/server/meta-leads"

const ALLOWED_ROLES = ["ADMIN", "DIRECTOR", "GERENTE", "MARKETING"]

export async function POST() {
  const session = await getServerSession()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const role = (session.user as { role?: string }).role || ""
  if (!ALLOWED_ROLES.includes(role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  try {
    const results = await syncZohoThenCompare()
    return NextResponse.json({ ok: true, ...results })
  } catch (error) {
    console.error("[Meta Leads Recompare] Error:", error)
    return NextResponse.json({ error: "Recompare failed" }, { status: 500 })
  }
}
