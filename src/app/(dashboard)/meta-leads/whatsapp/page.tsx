// Meta Leads — WhatsApp (leads de campanas con destino WhatsApp)
export const dynamic = "force-dynamic"

import { getServerSession } from "@/lib/auth/session"
import { redirect } from "next/navigation"
import { getMetaLeads, getMetaLeadCampaigns } from "@/server/meta-leads"
import { WhatsAppContent } from "./whatsapp-content"

interface Props {
  searchParams: Promise<{ status?: string; campaign?: string; search?: string; dateFrom?: string; dateTo?: string; page?: string }>
}

export default async function WhatsAppPage({ searchParams }: Props) {
  const session = await getServerSession()
  if (!session?.user) redirect("/login")

  const role = (session.user as { role?: string }).role || ""
  const allowedRoles = ["ADMIN", "DIRECTOR", "GERENTE", "MARKETING"]
  if (!allowedRoles.includes(role)) redirect("/dashboard")

  const params = await searchParams
  const status = params.status as "MATCHED" | "MISSING_IN_CRM" | "PENDING" | "DUPLICATE" | undefined
  const campaign = params.campaign
  const search = params.search
  const dateFrom = params.dateFrom
  const dateTo = params.dateTo
  const page = parseInt(params.page || "1", 10)

  const leadsData = await getMetaLeads({
    status, campaign, search, dateFrom, dateTo,
    isWhatsApp: true,
    page, pageSize: 50,
  })
  const campaigns = await getMetaLeadCampaigns()

  // Filter campaigns to only WhatsApp-related ones
  const whatsAppCampaigns = campaigns.filter(
    (c) => c.toUpperCase().includes("WSP") || c.toUpperCase().includes("WHATSAPP")
  )

  return (
    <WhatsAppContent
      leads={leadsData.leads}
      totalCount={leadsData.totalCount}
      pageCount={leadsData.pageCount}
      currentPage={page}
      campaigns={whatsAppCampaigns}
      filters={{ status, campaign, search, dateFrom, dateTo }}
    />
  )
}
