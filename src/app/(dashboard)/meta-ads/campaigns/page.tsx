// Meta Ads — Campanas
export const dynamic = "force-dynamic"

import { getServerSession } from "@/lib/auth/session"
import { redirect } from "next/navigation"
import { getMetaCampaigns, getMetaAccounts, getMetaThresholds } from "@/server/meta-ads"
import { CampaignsContent } from "./campaigns-content"

interface Props {
  searchParams: Promise<{ account?: string }>
}

export default async function MetaAdsCampaignsPage({ searchParams }: Props) {
  const session = await getServerSession()
  if (!session?.user) redirect("/login")

  const role = (session.user as { role?: string }).role || ""
  const allowedRoles = ["ADMIN", "DIRECTOR", "GERENTE", "LIDER", "MARKETING"]
  if (!allowedRoles.includes(role)) redirect("/dashboard")

  const params = await searchParams
  const accountId = params.account

  const [accounts, campaigns, thresholds] = await Promise.all([
    getMetaAccounts(),
    getMetaCampaigns(accountId),
    getMetaThresholds(),
  ])

  return (
    <CampaignsContent
      accounts={accounts.map((a) => ({
        id: a.id,
        accountId: a.accountId,
        name: a.name,
        currency: a.currency,
      }))}
      currentAccountId={accountId}
      campaigns={campaigns}
      thresholds={thresholds}
    />
  )
}
