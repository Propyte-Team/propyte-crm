// ============================================================
// API Route: GET /api/meta-leads/export
// Download CSV of leads missing in CRM (for Zoho import)
// ============================================================

import { NextResponse } from "next/server"
import { getServerSession } from "@/lib/auth/session"
import { exportMissingLeadsCSV } from "@/server/meta-leads"

const ALLOWED_ROLES = ["ADMIN", "DIRECTOR", "GERENTE", "MARKETING"]

export async function GET() {
  const session = await getServerSession()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const role = (session.user as { role?: string }).role || ""
  if (!ALLOWED_ROLES.includes(role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  try {
    const csv = await exportMissingLeadsCSV()
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="meta_leads_faltantes_${new Date().toISOString().split("T")[0]}.csv"`,
      },
    })
  } catch (error) {
    console.error("[Meta Leads Export] Error:", error)
    return NextResponse.json({ error: "Export failed" }, { status: 500 })
  }
}
