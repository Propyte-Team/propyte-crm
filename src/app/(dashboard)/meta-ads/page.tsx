// Meta Ads — Vista General (Overview)
import { getServerSession } from "@/lib/auth/session"
import { redirect } from "next/navigation"
import { getMetaOverview, getMetaDailyTrend, getMetaAccounts, getMetaCampaigns, getMetaThresholds } from "@/server/meta-ads"
import { MetaAdsOverview } from "./overview-content"

interface Props {
  searchParams: Promise<{ account?: string }>
}

export default async function MetaAdsPage({ searchParams }: Props) {
  const session = await getServerSession()
  if (!session?.user) redirect("/login")

  const role = (session.user as { role?: string }).role || ""
  const allowedRoles = ["ADMIN", "DIRECTOR", "GERENTE", "LIDER", "MARKETING"]
  if (!allowedRoles.includes(role)) redirect("/dashboard")

  const params = await searchParams
  const accountId = params.account

  const [accounts, overview, dailyTrend, campaigns, thresholds] = await Promise.all([
    getMetaAccounts(),
    getMetaOverview(accountId),
    getMetaDailyTrend(accountId, 30),
    getMetaCampaigns(accountId),
    getMetaThresholds(),
  ])

  return (
    <MetaAdsOverview
      accounts={accounts.map((a) => ({
        id: a.id,
        accountId: a.accountId,
        name: a.name,
        currency: a.currency,
      }))}
      currentAccountId={accountId}
      overview={{
        ...overview,
        lastSyncAt: overview.lastSyncAt?.toISOString() || null,
      }}
      dailyTrend={dailyTrend}
      topCampaigns={campaigns.slice(0, 5)}
      thresholds={thresholds}
    />
  )
}
