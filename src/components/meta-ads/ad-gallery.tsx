// Ad Creative Gallery — Design System v2
"use client"

import { useState, useEffect } from "react"
import { ExternalLink, ImageOff, Loader2 } from "lucide-react"

interface AdItem {
  id: string
  name: string
  status: string
  campaignId: string
  adsetId: string
  creative: {
    id: string
    name?: string
    title?: string
    body?: string
    imageUrl?: string
  }
  spend: number
  clicks: number
  impressions: number
}

interface AdGalleryProps {
  accountId: string
}

function formatMXN(value: number): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(value)
}

const statusLabels: Record<string, string> = {
  ACTIVE: "Activo",
  PAUSED: "Pausado",
  DELETED: "Eliminado",
  CAMPAIGN_PAUSED: "Pausado",
  ADSET_PAUSED: "Pausado",
}

export function AdGallery({ accountId }: AdGalleryProps) {
  const [ads, setAds] = useState<AdItem[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<"ACTIVE" | "ALL">("ACTIVE")

  useEffect(() => {
    async function fetchAds() {
      setLoading(true)
      try {
        const res = await fetch(
          `/api/meta-ads/ads?account_id=${accountId}&status=${filter}`
        )
        const json = await res.json()
        setAds(json.data || [])
      } catch {
        setAds([])
      } finally {
        setLoading(false)
      }
    }
    fetchAds()
  }, [accountId, filter])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[15px] font-semibold" style={{ color: "var(--text-primary)" }}>
          Anuncios ({ads.length})
        </h3>
        <div className="flex gap-1">
          {(["ACTIVE", "ALL"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className="rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors"
              style={{
                background: filter === f ? "var(--color-teal-light)" : "transparent",
                color: filter === f ? "var(--color-teal)" : "var(--text-tertiary)",
              }}
            >
              {f === "ACTIVE" ? "Activos" : "Todos"}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin" style={{ color: "var(--color-teal)" }} />
        </div>
      ) : ads.length === 0 ? (
        <div className="crm-card flex h-48 items-center justify-center text-sm" style={{ color: "var(--text-tertiary)" }}>
          No hay anuncios {filter === "ACTIVE" ? "activos" : ""}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {ads.map((ad) => (
            <div key={ad.id} className="crm-card overflow-hidden p-0">
              {/* Image */}
              <div className="relative h-40 w-full" style={{ background: "var(--bg-elevated)" }}>
                {ad.creative.imageUrl ? (
                  <img
                    src={ad.creative.imageUrl}
                    alt={ad.creative.title || ad.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <ImageOff className="h-8 w-8" style={{ color: "var(--text-tertiary)" }} />
                  </div>
                )}
                {/* Status badge */}
                <span
                  className="absolute right-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                  style={{
                    background: ad.status === "ACTIVE" ? "rgba(34, 197, 94, 0.9)" : "rgba(100, 116, 139, 0.9)",
                    color: "#fff",
                  }}
                >
                  {statusLabels[ad.status] || ad.status}
                </span>
              </div>

              {/* Content */}
              <div className="p-3">
                <p className="truncate text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>
                  {ad.creative.title || ad.name}
                </p>
                {ad.creative.body && (
                  <p
                    className="mt-1 line-clamp-2 text-[11px] leading-relaxed"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {ad.creative.body}
                  </p>
                )}

                {/* Metrics */}
                <div
                  className="mt-3 flex items-center gap-3 border-t pt-2 text-[11px]"
                  style={{ borderColor: "var(--border-subtle)", color: "var(--text-tertiary)" }}
                >
                  <span>{formatMXN(ad.spend)}</span>
                  <span>{ad.clicks} clicks</span>
                  <a
                    href={`https://www.facebook.com/ads/manager/account/campaigns?act=${accountId.replace("act_", "")}&selected_adset_ids=${ad.adsetId}&selected_ad_ids=${ad.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-auto"
                    style={{ color: "var(--color-teal)" }}
                    title="Ver en Meta Ads Manager"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
