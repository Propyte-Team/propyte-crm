// ============================================================
// API Route: GET /api/meta-ads/ads
// Real-time ads with creative previews from Meta API
// ============================================================

import { NextResponse } from "next/server"
import { getServerSession } from "@/lib/auth/session"
import { getMetaAPI } from "@/lib/meta/client"

const ALLOWED_ROLES = ["ADMIN", "DIRECTOR", "GERENTE", "LIDER", "MARKETING"]

interface MetaAdWithCreative {
  id: string
  name: string
  status: string
  effective_status: string
  adset_id: string
  campaign_id: string
  creative: {
    id: string
    name?: string
    title?: string
    body?: string
    image_url?: string
    thumbnail_url?: string
  }
}

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
  const statusFilter = searchParams.get("status") || "ACTIVE"

  try {
    const api = getMetaAPI()

    // Get ads with their creatives
    const ads = await api.requestAll<MetaAdWithCreative>(
      `/${accountId}/ads`,
      {
        fields: "id,name,status,effective_status,adset_id,campaign_id,creative{id,name,title,body,image_url,thumbnail_url}",
        filtering: JSON.stringify([
          { field: "effective_status", operator: "IN", value: statusFilter === "ALL" ? ["ACTIVE", "PAUSED"] : [statusFilter] },
        ]),
      }
    )

    // Get insights for each ad (batch)
    const adIds = ads.map((a) => a.id)
    const insightsMap: Record<string, { spend: string; clicks: string; impressions: string }> = {}

    if (adIds.length > 0) {
      try {
        const insights = await api.requestAll<{
          ad_id: string
          spend: string
          clicks: string
          impressions: string
        }>(
          `/${accountId}/insights`,
          {
            fields: "ad_id,spend,clicks,impressions",
            level: "ad",
            date_preset: "last_7d",
            filtering: JSON.stringify([
              { field: "ad.id", operator: "IN", value: adIds.slice(0, 50) },
            ]),
          }
        )
        for (const i of insights) {
          insightsMap[i.ad_id] = i
        }
      } catch {
        // Insights may not be available
      }
    }

    const result = ads.map((ad) => {
      const insight = insightsMap[ad.id]
      return {
        id: ad.id,
        name: ad.name,
        status: ad.effective_status || ad.status,
        campaignId: ad.campaign_id,
        adsetId: ad.adset_id,
        creative: {
          id: ad.creative?.id,
          name: ad.creative?.name,
          title: ad.creative?.title,
          body: ad.creative?.body,
          imageUrl: ad.creative?.image_url || ad.creative?.thumbnail_url,
        },
        spend: parseFloat(insight?.spend || "0"),
        clicks: parseInt(insight?.clicks || "0", 10),
        impressions: parseInt(insight?.impressions || "0", 10),
      }
    })

    return NextResponse.json({ data: result })
  } catch (error) {
    return NextResponse.json(
      { error: "Error al obtener anuncios", message: String(error) },
      { status: 500 }
    )
  }
}
