// Meta Leads — Discrepancias (solo leads faltantes en CRM)
export const dynamic = "force-dynamic"

import { getServerSession } from "@/lib/auth/session"
import { redirect } from "next/navigation"
import { getMetaLeads, getMetaLeadCampaigns } from "@/server/meta-leads"
import { DiscrepanciesContent } from "./discrepancies-content"

interface Props {
  searchParams: Promise<{ campaign?: string; search?: string; page?: string }>
}

export default async function DiscrepanciesPage({ searchParams }: Props) {
  const session = await getServerSession()
  if (!session?.user) redirect("/login")

  const role = (session.user as { role?: string }).role || ""
  const allowedRoles = ["ADMIN", "DIRECTOR", "GERENTE", "MARKETING"]
  if (!allowedRoles.includes(role)) redirect("/dashboard")

  const params = await searchParams
  const campaign = params.campaign
  const search = params.search
  const page = parseInt(params.page || "1", 10)

  const [leadsData, campaigns] = await Promise.all([
    getMetaLeads({ status: "MISSING_IN_CRM", campaign, search, page, pageSize: 50 }),
    getMetaLeadCampaigns(),
  ])

  return (
    <DiscrepanciesContent
      leads={leadsData.leads}
      totalCount={leadsData.totalCount}
      pageCount={leadsData.pageCount}
      currentPage={page}
      campaigns={campaigns}
      filters={{ campaign, search }}
    />
  )
}
