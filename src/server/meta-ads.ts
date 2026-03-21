// ============================================================
// Server Actions: Meta Ads
// Sync, overview, campaign data, daily trends
// ============================================================

import prisma from "@/lib/db"
import { getMetaAPI } from "@/lib/meta/client"
import type {
  MetaCampaign,
  MetaInsight,
  MetaOverviewData,
  MetaDailyData,
  MetaCampaignRow,
  MetaThresholds,
} from "@/lib/meta/types"

// ============================================================
// Helpers
// ============================================================

function extractLeads(actions?: { action_type: string; value: string }[]): number {
  if (!actions) return 0
  const lead = actions.find(
    (a) =>
      a.action_type === "lead" ||
      a.action_type === "onsite_conversion.lead_grouped" ||
      a.action_type === "offsite_conversion.fb_pixel_lead"
  )
  return lead ? parseInt(lead.value, 10) : 0
}

function safeNum(v: string | undefined | null): number {
  return v ? parseFloat(v) : 0
}

function pctChange(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0
  return Math.round(((current - previous) / previous) * 100)
}

// ============================================================
// getAdAccountIds — from env or database
// ============================================================

async function getActiveAccounts() {
  const accounts = await prisma.metaAdAccount.findMany({
    where: { isActive: true },
  })

  // If no accounts in DB, seed from env
  if (accounts.length === 0) {
    const envIds = (process.env.META_AD_ACCOUNT_IDS || "").split(",").filter(Boolean)
    const api = getMetaAPI()

    for (const accountId of envIds) {
      try {
        const info = await api.request<{ id: string; name: string; currency: string }>(
          `/${accountId}`,
          { fields: "id,name,currency" }
        )
        await prisma.metaAdAccount.upsert({
          where: { accountId },
          create: { accountId, name: info.name || accountId, currency: info.currency || "MXN" },
          update: { name: info.name || accountId, currency: info.currency || "MXN" },
        })
      } catch {
        await prisma.metaAdAccount.upsert({
          where: { accountId },
          create: { accountId, name: accountId, currency: "MXN" },
          update: {},
        })
      }
    }

    return prisma.metaAdAccount.findMany({ where: { isActive: true } })
  }

  return accounts
}

// ============================================================
// syncMetaInsights — Called by cron every 15 min
// ============================================================

export async function syncMetaInsights() {
  const api = getMetaAPI()
  const accounts = await getActiveAccounts()
  const results: { accountId: string; campaigns: number; days: number }[] = []

  for (const account of accounts) {
    try {
      // 1. Fetch campaigns
      const campaigns = await api.requestAll<MetaCampaign>(
        `/${account.accountId}/campaigns`,
        {
          fields: "id,name,status,effective_status,objective,daily_budget,lifetime_budget,start_time,stop_time",
          limit: 100,
        }
      )

      // 2. Fetch campaign-level insights (last 7 days)
      let campaignInsights: Record<string, MetaInsight> = {}
      try {
        const insights = await api.requestAll<MetaInsight & { campaign_id: string }>(
          `/${account.accountId}/insights`,
          {
            fields: "campaign_id,impressions,clicks,spend,reach,cpc,ctr,cpm,actions,cost_per_action_type",
            level: "campaign",
            date_preset: "last_7d",
          }
        )
        for (const i of insights) {
          campaignInsights[i.campaign_id] = i
        }
      } catch {
        // Insights might not be available for new accounts
      }

      // 3. Upsert campaign cache
      for (const c of campaigns) {
        const insight = campaignInsights[c.id]
        const leads = insight ? extractLeads(insight.actions) : 0
        const spend = safeNum(insight?.spend)

        await prisma.metaCampaignCache.upsert({
          where: {
            accountId_metaCampaignId: {
              accountId: account.id,
              metaCampaignId: c.id,
            },
          },
          create: {
            accountId: account.id,
            metaCampaignId: c.id,
            name: c.name,
            status: c.effective_status || c.status,
            objective: c.objective || "UNKNOWN",
            dailyBudget: c.daily_budget ? parseFloat(c.daily_budget) / 100 : null,
            lifetimeBudget: c.lifetime_budget ? parseFloat(c.lifetime_budget) / 100 : null,
            startTime: c.start_time ? new Date(c.start_time) : null,
            stopTime: c.stop_time ? new Date(c.stop_time) : null,
            impressions: parseInt(insight?.impressions || "0", 10),
            clicks: parseInt(insight?.clicks || "0", 10),
            spend,
            reach: parseInt(insight?.reach || "0", 10),
            cpc: safeNum(insight?.cpc) || null,
            ctr: safeNum(insight?.ctr) || null,
            cpm: safeNum(insight?.cpm) || null,
            leads,
            costPerLead: leads > 0 ? spend / leads : null,
          },
          update: {
            name: c.name,
            status: c.effective_status || c.status,
            objective: c.objective || "UNKNOWN",
            dailyBudget: c.daily_budget ? parseFloat(c.daily_budget) / 100 : null,
            lifetimeBudget: c.lifetime_budget ? parseFloat(c.lifetime_budget) / 100 : null,
            startTime: c.start_time ? new Date(c.start_time) : null,
            stopTime: c.stop_time ? new Date(c.stop_time) : null,
            impressions: parseInt(insight?.impressions || "0", 10),
            clicks: parseInt(insight?.clicks || "0", 10),
            spend,
            reach: parseInt(insight?.reach || "0", 10),
            cpc: safeNum(insight?.cpc) || null,
            ctr: safeNum(insight?.ctr) || null,
            cpm: safeNum(insight?.cpm) || null,
            leads,
            costPerLead: leads > 0 ? spend / leads : null,
          },
        })
      }

      // 4. Fetch daily insights (account-level, last 30 days)
      let dailyCount = 0
      try {
        const dailyInsights = await api.requestAll<MetaInsight>(
          `/${account.accountId}/insights`,
          {
            fields: "impressions,clicks,spend,reach,cpc,ctr,cpm,frequency,actions,cost_per_action_type",
            date_preset: "last_30d",
            time_increment: "1",
          }
        )

        for (const day of dailyInsights) {
          const leads = extractLeads(day.actions)
          const spend = safeNum(day.spend)
          const date = new Date(day.date_start)

          await prisma.metaDailyInsight.upsert({
            where: {
              accountId_date_level_metaObjectId: {
                accountId: account.id,
                date,
                level: "account",
                metaObjectId: account.accountId,
              },
            },
            create: {
              accountId: account.id,
              date,
              level: "account",
              metaObjectId: account.accountId,
              metaObjectName: account.name,
              impressions: parseInt(day.impressions || "0", 10),
              clicks: parseInt(day.clicks || "0", 10),
              spend,
              reach: parseInt(day.reach || "0", 10),
              cpc: safeNum(day.cpc) || null,
              ctr: safeNum(day.ctr) || null,
              cpm: safeNum(day.cpm) || null,
              frequency: safeNum(day.frequency) || null,
              leads,
              costPerLead: leads > 0 ? spend / leads : null,
              actionsJson: day.actions ? JSON.parse(JSON.stringify(day.actions)) : undefined,
            },
            update: {
              impressions: parseInt(day.impressions || "0", 10),
              clicks: parseInt(day.clicks || "0", 10),
              spend,
              reach: parseInt(day.reach || "0", 10),
              cpc: safeNum(day.cpc) || null,
              ctr: safeNum(day.ctr) || null,
              cpm: safeNum(day.cpm) || null,
              frequency: safeNum(day.frequency) || null,
              leads,
              costPerLead: leads > 0 ? spend / leads : null,
              actionsJson: day.actions ? JSON.parse(JSON.stringify(day.actions)) : undefined,
            },
          })
          dailyCount++
        }
      } catch {
        // Daily insights may fail for accounts without activity
      }

      // 5. Update last sync timestamp
      await prisma.metaAdAccount.update({
        where: { id: account.id },
        data: { lastSyncAt: new Date() },
      })

      results.push({
        accountId: account.accountId,
        campaigns: campaigns.length,
        days: dailyCount,
      })
    } catch (error) {
      console.error(`[Meta Sync] Error for ${account.accountId}:`, error)
      results.push({ accountId: account.accountId, campaigns: 0, days: 0 })
    }
  }

  return results
}

// ============================================================
// getMetaAccounts — List all tracked accounts
// ============================================================

export async function getMetaAccounts() {
  return prisma.metaAdAccount.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
  })
}

// ============================================================
// getMetaOverview — KPIs for the overview dashboard
// ============================================================

export async function getMetaOverview(accountId?: string): Promise<MetaOverviewData> {
  // Find account
  let account
  if (accountId) {
    account = await prisma.metaAdAccount.findFirst({
      where: { OR: [{ id: accountId }, { accountId }] },
    })
  } else {
    account = await prisma.metaAdAccount.findFirst({ where: { isActive: true } })
  }

  if (!account) {
    return {
      spend7d: 0, spend30d: 0, leads7d: 0, leads30d: 0,
      cpl7d: 0, cpl30d: 0, impressions7d: 0, reach7d: 0, ctr7d: 0,
      spendTrend: 0, leadsTrend: 0, cplTrend: 0,
      activeCampaigns: 0, lastSyncAt: null,
    }
  }

  const now = new Date()
  const d7ago = new Date(now.getTime() - 7 * 86400000)
  const d14ago = new Date(now.getTime() - 14 * 86400000)
  const d30ago = new Date(now.getTime() - 30 * 86400000)

  // Last 7 days
  const insights7d = await prisma.metaDailyInsight.findMany({
    where: {
      accountId: account.id,
      level: "account",
      date: { gte: d7ago },
    },
  })

  // Previous 7 days (for trend)
  const insightsPrev7d = await prisma.metaDailyInsight.findMany({
    where: {
      accountId: account.id,
      level: "account",
      date: { gte: d14ago, lt: d7ago },
    },
  })

  // Last 30 days
  const insights30d = await prisma.metaDailyInsight.findMany({
    where: {
      accountId: account.id,
      level: "account",
      date: { gte: d30ago },
    },
  })

  const sum = (arr: typeof insights7d, key: "spend" | "leads" | "impressions" | "reach" | "clicks") =>
    arr.reduce((acc: number, r: (typeof insights7d)[0]) => acc + (key === "spend" ? Number(r[key]) : (r[key] as number)), 0)

  const spend7d = sum(insights7d, "spend")
  const spend30d = sum(insights30d, "spend")
  const leads7d = sum(insights7d, "leads")
  const leads30d = sum(insights30d, "leads")
  const impressions7d = sum(insights7d, "impressions")
  const reach7d = sum(insights7d, "reach")
  const clicks7d = sum(insights7d, "clicks")

  const prevSpend = sum(insightsPrev7d, "spend")
  const prevLeads = sum(insightsPrev7d, "leads")

  const cpl7d = leads7d > 0 ? spend7d / leads7d : 0
  const cpl30d = leads30d > 0 ? spend30d / leads30d : 0
  const prevCpl = prevLeads > 0 ? prevSpend / prevLeads : 0
  const ctr7d = impressions7d > 0 ? (clicks7d / impressions7d) * 100 : 0

  const activeCampaigns = await prisma.metaCampaignCache.count({
    where: { accountId: account.id, status: "ACTIVE" },
  })

  return {
    spend7d,
    spend30d,
    leads7d,
    leads30d,
    cpl7d,
    cpl30d,
    impressions7d,
    reach7d,
    ctr7d,
    spendTrend: pctChange(spend7d, prevSpend),
    leadsTrend: pctChange(leads7d, prevLeads),
    cplTrend: pctChange(cpl7d, prevCpl),
    activeCampaigns,
    lastSyncAt: account.lastSyncAt,
  }
}

// ============================================================
// getMetaCampaigns — Campaign table data
// ============================================================

export async function getMetaCampaigns(accountId?: string): Promise<MetaCampaignRow[]> {
  let account
  if (accountId) {
    account = await prisma.metaAdAccount.findFirst({
      where: { OR: [{ id: accountId }, { accountId }] },
    })
  } else {
    account = await prisma.metaAdAccount.findFirst({ where: { isActive: true } })
  }

  if (!account) return []

  const campaigns = await prisma.metaCampaignCache.findMany({
    where: { accountId: account.id },
    orderBy: { spend: "desc" },
  })

  return campaigns.map((c) => ({
    id: c.id,
    metaCampaignId: c.metaCampaignId,
    name: c.name,
    status: c.status,
    objective: c.objective,
    dailyBudget: c.dailyBudget ? Number(c.dailyBudget) : null,
    spend: Number(c.spend),
    impressions: c.impressions,
    clicks: c.clicks,
    ctr: c.ctr ? Number(c.ctr) : 0,
    reach: c.reach,
    leads: c.leads,
    costPerLead: c.costPerLead ? Number(c.costPerLead) : null,
  }))
}

// ============================================================
// getMetaDailyTrend — Data for spend/leads chart
// ============================================================

export async function getMetaDailyTrend(
  accountId?: string,
  days = 30
): Promise<MetaDailyData[]> {
  let account
  if (accountId) {
    account = await prisma.metaAdAccount.findFirst({
      where: { OR: [{ id: accountId }, { accountId }] },
    })
  } else {
    account = await prisma.metaAdAccount.findFirst({ where: { isActive: true } })
  }

  if (!account) return []

  const since = new Date(Date.now() - days * 86400000)

  const insights = await prisma.metaDailyInsight.findMany({
    where: {
      accountId: account.id,
      level: "account",
      date: { gte: since },
    },
    orderBy: { date: "asc" },
  })

  return insights.map((r) => ({
    date: r.date.toISOString().split("T")[0],
    spend: Number(r.spend),
    leads: r.leads,
    impressions: r.impressions,
    clicks: r.clicks,
    reach: r.reach,
    cpl: r.leads > 0 ? Number(r.spend) / r.leads : 0,
  }))
}

// ============================================================
// getMetaThresholds — Read from SystemConfig or use defaults
// ============================================================

export async function getMetaThresholds(): Promise<MetaThresholds> {
  try {
    const config = await prisma.systemConfig.findUnique({
      where: { key: "meta_ads_thresholds" },
    })
    if (config?.value) {
      return config.value as unknown as MetaThresholds
    }
  } catch {
    // SystemConfig table might not have the entry yet
  }

  return {
    cpl_green: 150,
    cpl_yellow: 300,
    ctr_green: 2.0,
    ctr_yellow: 1.0,
    daily_leads_target: 10,
  }
}
