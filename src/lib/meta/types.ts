// ============================================================
// Meta Ads API — TypeScript interfaces
// ============================================================

export interface MetaAdAccount {
  id: string // "act_123456"
  name: string
  currency: string
  account_status: number // 1=ACTIVE, 2=DISABLED, 3=UNSETTLED, etc.
  amount_spent: string // lifetime spend in cents
  balance: string
}

export interface MetaCampaign {
  id: string
  name: string
  status: "ACTIVE" | "PAUSED" | "DELETED" | "ARCHIVED"
  effective_status: string
  objective: string
  daily_budget?: string // in cents
  lifetime_budget?: string
  start_time?: string
  stop_time?: string
  created_time: string
  updated_time: string
  special_ad_categories?: string[]
  bid_strategy?: string
}

export interface MetaAdSet {
  id: string
  name: string
  campaign_id: string
  status: "ACTIVE" | "PAUSED" | "DELETED" | "ARCHIVED"
  effective_status: string
  daily_budget?: string
  lifetime_budget?: string
  optimization_goal: string
  billing_event: string
  targeting: MetaTargeting
  start_time?: string
  end_time?: string
}

export interface MetaTargeting {
  age_min?: number
  age_max?: number
  genders?: number[]
  geo_locations?: {
    countries?: string[]
    regions?: { key: string; name: string }[]
    cities?: { key: string; name: string; radius?: number }[]
  }
  interests?: { id: string; name: string }[]
  behaviors?: { id: string; name: string }[]
  custom_audiences?: { id: string; name: string }[]
  excluded_custom_audiences?: { id: string; name: string }[]
}

export interface MetaAd {
  id: string
  name: string
  adset_id: string
  campaign_id: string
  status: "ACTIVE" | "PAUSED" | "DELETED" | "ARCHIVED"
  effective_status: string
  creative?: {
    id: string
    name?: string
    title?: string
    body?: string
    image_url?: string
    thumbnail_url?: string
    object_story_spec?: Record<string, unknown>
  }
  preview_url?: string
}

export interface MetaInsight {
  date_start: string
  date_stop: string
  impressions: string
  clicks: string
  spend: string
  reach: string
  cpc?: string
  ctr?: string
  cpm?: string
  frequency?: string
  actions?: MetaAction[]
  cost_per_action_type?: MetaAction[]
}

export interface MetaAction {
  action_type: string
  value: string
}

export interface MetaAudience {
  id: string
  name: string
  subtype: string
  approximate_count_lower_bound?: number
  approximate_count_upper_bound?: number
  description?: string
  delivery_status?: { status: string }
}

// Dashboard-specific interfaces
export interface MetaOverviewData {
  spend7d: number
  spend30d: number
  leads7d: number
  leads30d: number
  cpl7d: number
  cpl30d: number
  impressions7d: number
  reach7d: number
  ctr7d: number
  // Trends vs previous period
  spendTrend: number // % change
  leadsTrend: number
  cplTrend: number
  activeCampaigns: number
  lastSyncAt: Date | null
}

export interface MetaDailyData {
  date: string
  spend: number
  leads: number
  impressions: number
  clicks: number
  reach: number
  cpl: number
}

export interface MetaCampaignRow {
  id: string
  metaCampaignId: string
  name: string
  status: string
  objective: string
  dailyBudget: number | null
  spend: number
  impressions: number
  clicks: number
  ctr: number
  reach: number
  leads: number
  costPerLead: number | null
}

// Thresholds for traffic-light system
export interface MetaThresholds {
  cpl_green: number   // < this = green
  cpl_yellow: number  // < this = yellow, >= = red
  ctr_green: number   // > this = green
  ctr_yellow: number  // > this = yellow, <= = red
  daily_leads_target: number
}

export const DEFAULT_THRESHOLDS: MetaThresholds = {
  cpl_green: 150,     // < $150 MXN = good
  cpl_yellow: 300,    // $150-300 = warning, > $300 = bad
  ctr_green: 2.0,     // > 2% = good
  ctr_yellow: 1.0,    // 1-2% = warning, < 1% = bad
  daily_leads_target: 10,
}
