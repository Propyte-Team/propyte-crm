// Meta Ads Overview — Client component
"use client"

import { MetaKpiCards } from "@/components/meta-ads/meta-kpi-cards"
import { SpendChart } from "@/components/meta-ads/spend-chart"
import { CampaignTable } from "@/components/meta-ads/campaign-table"
import { AccountSelector } from "@/components/meta-ads/account-selector"
import type { MetaOverviewData, MetaDailyData, MetaCampaignRow, MetaThresholds } from "@/lib/meta/types"

interface MetaAccount {
  id: string
  accountId: string
  name: string
  currency: string
}

interface MetaAdsOverviewProps {
  accounts: MetaAccount[]
  currentAccountId?: string
  overview: Omit<MetaOverviewData, "lastSyncAt"> & { lastSyncAt: string | null }
  dailyTrend: MetaDailyData[]
  topCampaigns: MetaCampaignRow[]
  thresholds: MetaThresholds
}

export function MetaAdsOverview({
  accounts,
  currentAccountId,
  overview,
  dailyTrend,
  topCampaigns,
  thresholds,
}: MetaAdsOverviewProps) {
  const overviewData: MetaOverviewData = {
    ...overview,
    lastSyncAt: overview.lastSyncAt ? new Date(overview.lastSyncAt) : null,
  }

  return (
    <div className="space-y-5">
      {/* Account selector + last sync */}
      <div className="flex items-center justify-between">
        <AccountSelector accounts={accounts} currentAccountId={currentAccountId} />
        {overview.lastSyncAt && (
          <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
            Ultima sync: {new Date(overview.lastSyncAt).toLocaleString("es-MX")}
          </span>
        )}
      </div>

      {/* KPIs */}
      <MetaKpiCards data={overviewData} thresholds={thresholds} />

      {/* Chart */}
      <SpendChart data={dailyTrend} />

      {/* Top campaigns */}
      <CampaignTable campaigns={topCampaigns} thresholds={thresholds} />
    </div>
  )
}
