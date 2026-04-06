// ============================================================
// Server Functions: Meta Leads
// Sync from Meta API, compare vs CRM contacts, stats
// ============================================================

import prisma from "@/lib/db"
import { getMetaAPI } from "@/lib/meta/client"
import type { MetaLeadStatus } from "@prisma/client"

// ============================================================
// Types
// ============================================================

interface MetaLeadField {
  name: string
  values: string[]
}

interface MetaLeadRaw {
  id: string
  created_time: string
  field_data?: MetaLeadField[]
  form_id?: string
  platform?: string
  ad_id?: string
  ad_name?: string
  adset_id?: string
  adset_name?: string
  campaign_id?: string
  campaign_name?: string
}

export interface MetaLeadStats {
  total: number
  matched: number
  missingInCrm: number
  pending: number
  duplicate: number
  lastSyncAt: string | null
  byCampaign: { name: string; total: number; missing: number }[]
}

export interface MetaLeadRow {
  id: string
  metaLeadId: string
  createdOnMeta: string
  firstName: string | null
  lastName: string | null
  email: string | null
  phone: string | null
  country: string | null
  language: string | null
  campaignName: string | null
  adsetName: string | null
  adName: string | null
  formName: string | null
  platform: string | null
  status: MetaLeadStatus
  matchedContactId: string | null
  matchMethod: string | null
}

// ============================================================
// Constants
// ============================================================

const AD_ACCOUNT = process.env.META_AD_ACCOUNT_IDS?.split(",")[0] || "act_1201682720552407"

const PAGE_NAMES: Record<string, string> = {
  "939477015926372": "Propyte Market",
  "834510929743516": "Propyte",
  "103981554499114": "Nativa Tulum",
}

// ============================================================
// Helpers
// ============================================================

function getFieldValue(fields: MetaLeadField[] | undefined, ...names: string[]): string | null {
  if (!fields) return null
  for (const name of names) {
    const field = fields.find((f) => f.name === name)
    if (field?.values?.length) return field.values.join(", ")
  }
  return null
}

function detectLanguage(fields: MetaLeadField[] | undefined): string {
  if (!fields) return "Espanol"
  const names = fields.map((f) => f.name)
  const hasEnglish = names.some(
    (n) =>
      n.includes("first_name") ||
      n.includes("last_name") ||
      n.includes("how_urgently") ||
      n.includes("what_is_your")
  )
  const hasSpanish = names.some(
    (n) =>
      n.includes("nombre") ||
      n.includes("apellido") ||
      n.includes("correo") ||
      n.includes("urgencia")
  )
  if (hasEnglish && !hasSpanish) return "Ingles"
  return "Espanol"
}

function normalizePhone(phone: string | null): string | null {
  if (!phone) return null
  return phone.replace(/[\s\-\(\)\+]/g, "").slice(-10)
}

function normalizeEmail(email: string | null): string | null {
  if (!email) return null
  return email.toLowerCase().trim()
}

// ============================================================
// syncMetaLeads — Pull leads from Meta API and store in DB
// ============================================================

export async function syncMetaLeads(): Promise<{
  fetched: number
  newLeads: number
  skipped: number
}> {
  const api = getMetaAPI()

  // Get all ads from account
  const ads = await api.requestAll<{
    id: string
    name: string
    adset_id?: string
    adset?: { name: string }
    campaign_id?: string
    campaign?: { name: string }
  }>(`/${AD_ACCOUNT}/ads`, {
    fields: "id,name,adset_id,adset{name},campaign_id,campaign{name}",
    filtering: [
      { field: "effective_status", operator: "IN", value: ["ACTIVE", "PAUSED"] },
    ],
  })

  // Since jan 2026 for initial sync, then only last 7 days for incremental
  const lastSync = await prisma.metaLead.findFirst({
    orderBy: { createdOnMeta: "desc" },
    select: { createdOnMeta: true },
  })

  const sinceDate = lastSync
    ? new Date(lastSync.createdOnMeta.getTime() - 7 * 24 * 60 * 60 * 1000) // 7 days overlap
    : new Date("2026-01-01T00:00:00Z")
  const sinceTimestamp = Math.floor(sinceDate.getTime() / 1000)

  let fetched = 0
  let newLeads = 0
  let skipped = 0

  // Get form name cache
  const formNameCache: Record<string, string> = {}

  for (const ad of ads) {
    try {
      const leads = await api.requestAll<MetaLeadRaw>(`/${ad.id}/leads`, {
        fields: "id,created_time,field_data,form_id,platform",
        filtering: [
          { field: "time_created", operator: "GREATER_THAN", value: sinceTimestamp },
        ],
      })

      for (const lead of leads) {
        fetched++

        // Check if already exists
        const exists = await prisma.metaLead.findUnique({
          where: { metaLeadId: lead.id },
          select: { id: true },
        })

        if (exists) {
          skipped++
          continue
        }

        // Resolve form name
        let formName = formNameCache[lead.form_id || ""]
        if (!formName && lead.form_id) {
          try {
            const form = await api.request<{ id: string; name: string; page_id?: string }>(
              `/${lead.form_id}`,
              { fields: "id,name,page_id" }
            )
            formName = form.name
            formNameCache[lead.form_id] = formName
          } catch {
            formName = lead.form_id
          }
        }

        const fields = lead.field_data
        const extraFields: Record<string, string> = {}
        if (fields) {
          for (const f of fields) {
            // Collect fields that don't map to standard columns
            const mapped = [
              "first_name", "nombre", "last_name", "apellido",
              "email", "correo_electrónico", "phone_number", "número_de_teléfono",
              "user_provided_phone_number", "country", "país", "estado",
            ]
            if (!mapped.some((m) => f.name.includes(m))) {
              extraFields[f.name] = f.values?.join(", ") || ""
            }
          }
        }

        await prisma.metaLead.create({
          data: {
            metaLeadId: lead.id,
            createdOnMeta: new Date(lead.created_time),
            firstName: getFieldValue(fields, "first_name", "nombre"),
            lastName: getFieldValue(fields, "last_name", "apellido"),
            email: getFieldValue(fields, "email", "correo_electrónico"),
            phone: getFieldValue(fields, "phone_number", "número_de_teléfono", "user_provided_phone_number"),
            country: getFieldValue(fields, "country", "país", "estado"),
            language: detectLanguage(fields),
            urgency: getFieldValue(fields,
              "how_urgently_do_you_want_to_buy?",
              "¿con_qué_urgencia_quieres_comprar?"
            ),
            acquisition: getFieldValue(fields,
              "how_do_you_plan_to_acquire_your_property?",
              "¿cómo_planeas_adquirir_tu_propiedad?"
            ),
            budget: getFieldValue(fields,
              "what_is_your_estimated_budget_range?",
              "¿cuál_es_tu_rango_de_presupuesto_estimado?"
            ),
            description: getFieldValue(fields,
              "looking_to_invest_in_a_property_(house,_apartment,_or_land)?",
              "¿buscar_invertir_en_un_inmueble_(casa,_departamento_o_terreno?",
              "¿buscas_invertir_en_inmuebles_en_tulum?",
              "what_is_your_main_interest_in_the_riviera_maya?",
              "¿cuál_es_tu_interés_principal_en_la_riviera_maya?"
            ),
            extraFields: Object.keys(extraFields).length > 0 ? extraFields : undefined,
            campaignId: ad.campaign_id || null,
            campaignName: ad.campaign?.name || null,
            adsetId: ad.adset_id || null,
            adsetName: ad.adset?.name || null,
            adId: ad.id,
            adName: ad.name,
            formId: lead.form_id || null,
            formName: formName || null,
            platform: lead.platform || null,
            status: "PENDING",
          },
        })
        newLeads++
      }
    } catch {
      // Skip ads without leads endpoint (non-lead-gen ads)
    }
  }

  // After inserting, run comparison
  await compareLeadsWithCRM()

  return { fetched, newLeads, skipped }
}

// ============================================================
// compareLeadsWithCRM — Match MetaLeads against Contact table
// ============================================================

export async function compareLeadsWithCRM(): Promise<{
  matched: number
  missing: number
}> {
  const pendingLeads = await prisma.metaLead.findMany({
    where: { status: "PENDING" },
    select: { id: true, email: true, phone: true },
  })

  let matched = 0
  let missing = 0

  for (const lead of pendingLeads) {
    const normEmail = normalizeEmail(lead.email)
    const normPhone = normalizePhone(lead.phone)

    let contact = null
    let matchMethod = ""

    // Try email match first
    if (normEmail) {
      contact = await prisma.contact.findFirst({
        where: { email: { equals: normEmail, mode: "insensitive" } },
        select: { id: true },
      })
      if (contact) matchMethod = "email"
    }

    // Try phone match
    if (!contact && normPhone) {
      contact = await prisma.contact.findFirst({
        where: {
          OR: [
            { phone: { contains: normPhone } },
            { secondaryPhone: { contains: normPhone } },
          ],
        },
        select: { id: true },
      })
      if (contact) matchMethod = "phone"
    }

    // If both matched, upgrade to "both"
    if (contact && normEmail && normPhone && matchMethod === "email") {
      const phoneMatch = await prisma.contact.findFirst({
        where: {
          id: contact.id,
          OR: [
            { phone: { contains: normPhone } },
            { secondaryPhone: { contains: normPhone } },
          ],
        },
        select: { id: true },
      })
      if (phoneMatch) matchMethod = "both"
    }

    if (contact) {
      await prisma.metaLead.update({
        where: { id: lead.id },
        data: {
          status: "MATCHED",
          matchedContactId: contact.id,
          matchedAt: new Date(),
          matchMethod,
        },
      })
      matched++
    } else {
      await prisma.metaLead.update({
        where: { id: lead.id },
        data: { status: "MISSING_IN_CRM" },
      })
      missing++
    }
  }

  // Check for duplicates (same email or phone appearing multiple times in meta_leads)
  const duplicateEmails = await prisma.$queryRaw<{ email: string }[]>`
    SELECT email FROM propyte_crm.meta_leads
    WHERE email IS NOT NULL
    GROUP BY email
    HAVING COUNT(*) > 1
  `
  for (const dup of duplicateEmails) {
    const leads = await prisma.metaLead.findMany({
      where: { email: dup.email },
      orderBy: { createdOnMeta: "asc" },
      select: { id: true },
    })
    // Mark all except the first as DUPLICATE
    for (let i = 1; i < leads.length; i++) {
      const current = await prisma.metaLead.findUnique({
        where: { id: leads[i].id },
        select: { status: true },
      })
      if (current?.status === "PENDING") {
        await prisma.metaLead.update({
          where: { id: leads[i].id },
          data: { status: "DUPLICATE" },
        })
      }
    }
  }

  return { matched, missing }
}

// ============================================================
// getMetaLeadStats — KPIs for dashboard
// ============================================================

export async function getMetaLeadStats(): Promise<MetaLeadStats> {
  const [total, matched, missingInCrm, pending, duplicate] = await Promise.all([
    prisma.metaLead.count(),
    prisma.metaLead.count({ where: { status: "MATCHED" } }),
    prisma.metaLead.count({ where: { status: "MISSING_IN_CRM" } }),
    prisma.metaLead.count({ where: { status: "PENDING" } }),
    prisma.metaLead.count({ where: { status: "DUPLICATE" } }),
  ])

  const lastLead = await prisma.metaLead.findFirst({
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  })

  // Group by campaign
  const campaigns = await prisma.metaLead.groupBy({
    by: ["campaignName", "status"],
    _count: true,
  })

  const campaignMap: Record<string, { total: number; missing: number }> = {}
  for (const row of campaigns) {
    const name = row.campaignName || "Sin campaña"
    if (!campaignMap[name]) campaignMap[name] = { total: 0, missing: 0 }
    campaignMap[name].total += row._count
    if (row.status === "MISSING_IN_CRM") campaignMap[name].missing += row._count
  }

  const byCampaign = Object.entries(campaignMap)
    .map(([name, data]) => ({ name, ...data }))
    .sort((a, b) => b.total - a.total)

  return {
    total,
    matched,
    missingInCrm,
    pending,
    duplicate,
    lastSyncAt: lastLead?.createdAt?.toISOString() || null,
    byCampaign,
  }
}

// ============================================================
// getMetaLeads — Paginated list for table
// ============================================================

export async function getMetaLeads(opts: {
  status?: MetaLeadStatus
  campaign?: string
  search?: string
  page?: number
  pageSize?: number
}): Promise<{ leads: MetaLeadRow[]; totalCount: number; pageCount: number }> {
  const { status, campaign, search, page = 1, pageSize = 50 } = opts

  const where: Record<string, unknown> = {}
  if (status) where.status = status
  if (campaign) where.campaignName = campaign
  if (search) {
    where.OR = [
      { firstName: { contains: search, mode: "insensitive" } },
      { lastName: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
      { phone: { contains: search } },
    ]
  }

  const [totalCount, leads] = await Promise.all([
    prisma.metaLead.count({ where }),
    prisma.metaLead.findMany({
      where,
      orderBy: { createdOnMeta: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        metaLeadId: true,
        createdOnMeta: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        country: true,
        language: true,
        campaignName: true,
        adsetName: true,
        adName: true,
        formName: true,
        platform: true,
        status: true,
        matchedContactId: true,
        matchMethod: true,
      },
    }),
  ])

  return {
    leads: leads.map((l) => ({
      ...l,
      createdOnMeta: l.createdOnMeta.toISOString(),
    })),
    totalCount,
    pageCount: Math.ceil(totalCount / pageSize),
  }
}

// ============================================================
// getMetaLeadCampaigns — Unique campaign names for filter
// ============================================================

export async function getMetaLeadCampaigns(): Promise<string[]> {
  const rows = await prisma.metaLead.findMany({
    distinct: ["campaignName"],
    where: { campaignName: { not: null } },
    select: { campaignName: true },
    orderBy: { campaignName: "asc" },
  })
  return rows.map((r) => r.campaignName!).filter(Boolean)
}

// ============================================================
// exportMissingLeadsCSV — Generate CSV of leads missing in CRM
// ============================================================

export async function exportMissingLeadsCSV(): Promise<string> {
  const leads = await prisma.metaLead.findMany({
    where: { status: "MISSING_IN_CRM" },
    orderBy: { createdOnMeta: "desc" },
  })

  const headers = [
    "Social Lead ID", "Nombre", "Apellidos", "Teléfono", "Correo electrónico",
    "País", "Idioma", "Urgencia", "Adquisición", "Presupuesto", "Descripción",
    "Fuente de Posible cliente", "Nombre de Campaña", "Nombre del formulario",
    "Nombre de Grupo de Anuncios", "Nombre anuncio", "Plataforma de llegada",
    "Fecha",
  ]

  function esc(val: string | null | undefined): string {
    const s = String(val ?? "")
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`
    }
    return s
  }

  const rows = leads.map((l) =>
    [
      l.metaLeadId, l.firstName, l.lastName, l.phone, l.email,
      l.country, l.language, l.urgency, l.acquisition, l.budget, l.description,
      "Meta Ads", l.campaignName, l.formName,
      l.adsetName, l.adName, l.platform,
      l.createdOnMeta.toISOString().split("T")[0],
    ]
      .map(esc)
      .join(",")
  )

  return "\uFEFF" + [headers.join(","), ...rows].join("\r\n")
}

// ============================================================
// rerunComparison — Re-compare all leads (useful after CRM import)
// ============================================================

export async function rerunComparison(): Promise<{ matched: number; missing: number }> {
  // Reset all non-duplicate leads to PENDING
  await prisma.metaLead.updateMany({
    where: { status: { not: "DUPLICATE" } },
    data: { status: "PENDING", matchedContactId: null, matchedAt: null, matchMethod: null },
  })

  return compareLeadsWithCRM()
}
