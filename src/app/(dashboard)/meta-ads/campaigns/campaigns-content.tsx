// Campaigns content — Client component
"use client"

import { AccountSelector } from "@/components/meta-ads/account-selector"
import { CampaignTable } from "@/components/meta-ads/campaign-table"
import type { MetaCampaignRow, MetaThresholds } from "@/lib/meta/types"

interface MetaAccount {
  id: string
  accountId: string
  name: string
  currency: string
}

interface CampaignsContentProps {
  accounts: MetaAccount[]
  currentAccountId?: string
  campaigns: MetaCampaignRow[]
  thresholds: MetaThresholds
}

export function CampaignsContent({
  accounts,
  currentAccountId,
  campaigns,
  thresholds,
}: CampaignsContentProps) {
  return (
    <div className="space-y-5">
      <AccountSelector accounts={accounts} currentAccountId={currentAccountId} />
      <CampaignTable campaigns={campaigns} thresholds={thresholds} />
    </div>
  )
}
