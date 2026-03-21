// ============================================================
// API Route: GET /api/meta-ads/campaigns
// Real-time campaign status from Meta API
// ============================================================

import { NextResponse } from "next/server"
import { getServerSession } from "@/lib/auth/session"
import { getMetaAPI } from "@/lib/meta/client"
import type { MetaCampaign } from "@/lib/meta/types"

const ALLOWED_ROLES = ["ADMIN", "DIRECTOR", "GERENTE", "LIDER", "MARKETING"]

export async function GET(request: Request) {
  const session = await getServerSession()
  if (!session?.user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  }

  const role = (session.user as { role?: string }).role || ""
  if (!ALLOWED_ROLES.includes(role)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const accountId = searchParams.get("account_id") || process.env.META_AD_ACCOUNT_IDS?.split(",")[0] || ""

  try {
    const api = getMetaAPI()
    const campaigns = await api.requestAll<MetaCampaign>(
      `/${accountId}/campaigns`,
      {
        fields: "id,name,status,effective_status,objective,daily_budget,lifetime_budget,start_time,stop_time,created_time",
      }
    )

    return NextResponse.json({ data: campaigns })
  } catch (error) {
    return NextResponse.json(
      { error: "Error al obtener campañas", message: String(error) },
      { status: 500 }
    )
  }
}
