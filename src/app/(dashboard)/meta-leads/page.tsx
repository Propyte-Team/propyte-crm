// Meta Leads — Overview (KPIs + tabla de todos los leads)
export const dynamic = "force-dynamic"

import { getServerSession } from "@/lib/auth/session"
import { redirect } from "next/navigation"
import { getMetaLeadStats, getMetaLeads, getMetaLeadCampaigns } from "@/server/meta-leads"
import { MetaLeadsOverview } from "./overview-content"

interface Props {
  searchParams: Promise<{ status?: string; campaign?: string; search?: string; page?: string }>
}

export default async function MetaLeadsPage({ searchParams }: Props) {
  const session = await getServerSession()
  if (!session?.user) redirect("/login")

  const role = (session.user as { role?: string }).role || ""
  const allowedRoles = ["ADMIN", "DIRECTOR", "GERENTE", "MARKETING"]
  if (!allowedRoles.includes(role)) redirect("/dashboard")

  const params = await searchParams
  const status = params.status as "MATCHED" | "MISSING_IN_CRM" | "PENDING" | "DUPLICATE" | undefined
  const campaign = params.campaign
  const search = params.search
  const page = parseInt(params.page || "1", 10)

  const [stats, leadsData, campaigns] = await Promise.all([
    getMetaLeadStats(),
    getMetaLeads({ status, campaign, search, page, pageSize: 50 }),
    getMetaLeadCampaigns(),
  ])

  return (
    <MetaLeadsOverview
      stats={stats}
      leads={leadsData.leads}
      totalCount={leadsData.totalCount}
      pageCount={leadsData.pageCount}
      currentPage={page}
      campaigns={campaigns}
      filters={{ status, campaign, search }}
    />
  )
}
