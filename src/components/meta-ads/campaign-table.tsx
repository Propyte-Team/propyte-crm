// Campaign performance table — Design System v2
"use client"

import { useState } from "react"
import { ArrowUpDown, Circle } from "lucide-react"
import type { MetaCampaignRow, MetaThresholds } from "@/lib/meta/types"

interface CampaignTableProps {
  campaigns: MetaCampaignRow[]
  thresholds: MetaThresholds
}

type SortKey = keyof MetaCampaignRow
type SortDir = "asc" | "desc"

function formatMXN(value: number): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(value)
}

function formatCompact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return value.toLocaleString("es-MX")
}

const statusColors: Record<string, { bg: string; text: string }> = {
  ACTIVE: { bg: "rgba(34, 197, 94, 0.15)", text: "#22C55E" },
  PAUSED: { bg: "rgba(148, 163, 184, 0.15)", text: "#94A3B8" },
  DELETED: { bg: "rgba(239, 68, 68, 0.15)", text: "#EF4444" },
  ARCHIVED: { bg: "rgba(148, 163, 184, 0.10)", text: "#64748B" },
}

const statusLabels: Record<string, string> = {
  ACTIVE: "Activa",
  PAUSED: "Pausada",
  DELETED: "Eliminada",
  ARCHIVED: "Archivada",
  CAMPAIGN_PAUSED: "Pausada",
  ADSET_PAUSED: "Ad Set Pausado",
  IN_PROCESS: "En proceso",
  WITH_ISSUES: "Con problemas",
}

function getCplIndicator(cpl: number | null, t: MetaThresholds): string {
  if (!cpl || cpl <= 0) return "#94A3B8"
  if (cpl < t.cpl_green) return "#22C55E"
  if (cpl < t.cpl_yellow) return "#F5A623"
  return "#EF4444"
}

const objectiveLabels: Record<string, string> = {
  OUTCOME_LEADS: "Leads",
  OUTCOME_TRAFFIC: "Trafico",
  OUTCOME_AWARENESS: "Alcance",
  OUTCOME_ENGAGEMENT: "Interaccion",
  OUTCOME_SALES: "Ventas",
  OUTCOME_APP_PROMOTION: "App",
  LINK_CLICKS: "Clicks",
  LEAD_GENERATION: "Leads",
  BRAND_AWARENESS: "Alcance",
  REACH: "Alcance",
  CONVERSIONS: "Conversiones",
  MESSAGES: "Mensajes",
  POST_ENGAGEMENT: "Engagement",
  VIDEO_VIEWS: "Video",
}

export function CampaignTable({ campaigns, thresholds }: CampaignTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("spend")
  const [sortDir, setSortDir] = useState<SortDir>("desc")

  const sorted = [...campaigns].sort((a, b) => {
    const aVal = a[sortKey] ?? 0
    const bVal = b[sortKey] ?? 0
    if (typeof aVal === "string" && typeof bVal === "string") {
      return sortDir === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal)
    }
    return sortDir === "asc"
      ? (aVal as number) - (bVal as number)
      : (bVal as number) - (aVal as number)
  })

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc")
    } else {
      setSortKey(key)
      setSortDir("desc")
    }
  }

  const columns: { key: SortKey; label: string; align?: string }[] = [
    { key: "name", label: "Campana" },
    { key: "status", label: "Status" },
    { key: "objective", label: "Objetivo" },
    { key: "dailyBudget", label: "Presup./dia", align: "right" },
    { key: "spend", label: "Gasto 7d", align: "right" },
    { key: "impressions", label: "Impresiones", align: "right" },
    { key: "clicks", label: "Clicks", align: "right" },
    { key: "ctr", label: "CTR", align: "right" },
    { key: "leads", label: "Leads", align: "right" },
    { key: "costPerLead", label: "CPL", align: "right" },
  ]

  return (
    <div className="crm-card overflow-hidden p-0">
      <div className="px-5 py-4">
        <h3 className="text-[15px] font-semibold" style={{ color: "var(--text-primary)" }}>
          Campanas ({campaigns.length})
        </h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr style={{ borderTop: "1px solid var(--border-subtle)" }}>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`cursor-pointer whitespace-nowrap px-4 py-2.5 font-medium ${col.align === "right" ? "text-right" : "text-left"}`}
                  style={{ color: "var(--text-tertiary)", borderBottom: "1px solid var(--border-subtle)" }}
                  onClick={() => toggleSort(col.key)}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.label}
                    <ArrowUpDown className="h-3 w-3 opacity-40" />
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="py-12 text-center" style={{ color: "var(--text-tertiary)" }}>
                  Sin campanas
                </td>
              </tr>
            )}
            {sorted.map((c) => {
              const st = statusColors[c.status] || statusColors.PAUSED
              return (
                <tr
                  key={c.id}
                  className="transition-colors"
                  style={{ borderBottom: "1px solid var(--border-subtle)" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.02)" }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent" }}
                >
                  <td className="max-w-[220px] truncate px-4 py-2.5 font-medium" style={{ color: "var(--text-primary)" }}>
                    {c.name}
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold"
                      style={{ background: st.bg, color: st.text }}
                    >
                      {statusLabels[c.status] || c.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5" style={{ color: "var(--text-secondary)" }}>
                    {objectiveLabels[c.objective] || c.objective}
                  </td>
                  <td className="px-4 py-2.5 text-right" style={{ color: "var(--text-secondary)" }}>
                    {c.dailyBudget ? formatMXN(c.dailyBudget) : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right font-medium" style={{ color: "var(--text-primary)" }}>
                    {formatMXN(c.spend)}
                  </td>
                  <td className="px-4 py-2.5 text-right" style={{ color: "var(--text-secondary)" }}>
                    {formatCompact(c.impressions)}
                  </td>
                  <td className="px-4 py-2.5 text-right" style={{ color: "var(--text-secondary)" }}>
                    {formatCompact(c.clicks)}
                  </td>
                  <td className="px-4 py-2.5 text-right" style={{ color: "var(--text-secondary)" }}>
                    {c.ctr.toFixed(2)}%
                  </td>
                  <td className="px-4 py-2.5 text-right font-medium" style={{ color: "var(--text-primary)" }}>
                    {c.leads}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <span className="inline-flex items-center gap-1.5">
                      <Circle
                        className="h-2 w-2"
                        fill={getCplIndicator(c.costPerLead, thresholds)}
                        stroke="none"
                      />
                      <span style={{ color: "var(--text-primary)" }}>
                        {c.costPerLead ? formatMXN(c.costPerLead) : "—"}
                      </span>
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
