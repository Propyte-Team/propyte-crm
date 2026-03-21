// KPI Cards para Meta Ads — Design System v2
"use client"

import { DollarSign, Users, Target, MousePointerClick, Eye } from "lucide-react"
import { KpiCard } from "@/components/dashboard/kpi-card"
import type { MetaOverviewData, MetaThresholds } from "@/lib/meta/types"

interface MetaKpiCardsProps {
  data: MetaOverviewData
  thresholds: MetaThresholds
}

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

// Traffic-light color logic
function getCplColor(cpl: number, t: MetaThresholds) {
  if (cpl <= 0) return { color: "#94A3B8", bg: "rgba(148, 163, 184, 0.12)" }
  if (cpl < t.cpl_green) return { color: "#22C55E", bg: "rgba(34, 197, 94, 0.12)" }
  if (cpl < t.cpl_yellow) return { color: "#F5A623", bg: "rgba(245, 166, 35, 0.12)" }
  return { color: "#EF4444", bg: "rgba(239, 68, 68, 0.12)" }
}

function getCtrColor(ctr: number, t: MetaThresholds) {
  if (ctr >= t.ctr_green) return { color: "#22C55E", bg: "rgba(34, 197, 94, 0.12)" }
  if (ctr >= t.ctr_yellow) return { color: "#F5A623", bg: "rgba(245, 166, 35, 0.12)" }
  return { color: "#EF4444", bg: "rgba(239, 68, 68, 0.12)" }
}

export function MetaKpiCards({ data, thresholds }: MetaKpiCardsProps) {
  const cplColors = getCplColor(data.cpl7d, thresholds)
  const ctrColors = getCtrColor(data.ctr7d, thresholds)

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
      <KpiCard
        title="Gasto (7 dias)"
        value={formatMXN(data.spend7d)}
        subtitle={`30d: ${formatMXN(data.spend30d)}`}
        trend={data.spendTrend}
        icon={DollarSign}
        color="#60A5FA"
        accentBg="rgba(96, 165, 250, 0.12)"
      />
      <KpiCard
        title="Leads (7 dias)"
        value={data.leads7d.toLocaleString("es-MX")}
        subtitle={`30d: ${data.leads30d.toLocaleString("es-MX")}`}
        trend={data.leadsTrend}
        icon={Users}
        color="#22C55E"
        accentBg="rgba(34, 197, 94, 0.12)"
      />
      <KpiCard
        title="Costo por Lead"
        value={data.cpl7d > 0 ? formatMXN(data.cpl7d) : "—"}
        subtitle={data.cpl30d > 0 ? `30d: ${formatMXN(data.cpl30d)}` : undefined}
        trend={data.cplTrend}
        icon={Target}
        color={cplColors.color}
        accentBg={cplColors.bg}
      />
      <KpiCard
        title="CTR"
        value={`${data.ctr7d.toFixed(2)}%`}
        subtitle={`${data.activeCampaigns} campanas activas`}
        trend={0}
        icon={MousePointerClick}
        color={ctrColors.color}
        accentBg={ctrColors.bg}
      />
      <KpiCard
        title="Alcance (7 dias)"
        value={formatCompact(data.reach7d)}
        subtitle={`${formatCompact(data.impressions7d)} impresiones`}
        trend={0}
        icon={Eye}
        color="#818CF8"
        accentBg="rgba(129, 140, 248, 0.12)"
      />
    </div>
  )
}
