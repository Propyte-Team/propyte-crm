// ============================================================
// Zoho CRM API Client
// OAuth2 con refresh automático + rate limiting
// ============================================================

import type {
  ZohoTokenResponse,
  ZohoRecord,
  ZohoRecordResponse,
  ZohoUpsertResponse,
} from "./types";

// --- Rate Limiter ---

class RateLimiter {
  private callCount = 0;
  private dayStart = Date.now();
  private readonly dailyLimit: number;

  constructor(dailyLimit: number) {
    this.dailyLimit = dailyLimit;
  }

  canMakeCall(): boolean {
    this.resetIfNewDay();
    return this.callCount < this.dailyLimit;
  }

  recordCall(): void {
    this.resetIfNewDay();
    this.callCount++;
  }

  getCallsToday(): number {
    this.resetIfNewDay();
    return this.callCount;
  }

  getRemainingCalls(): number {
    this.resetIfNewDay();
    return Math.max(0, this.dailyLimit - this.callCount);
  }

  private resetIfNewDay(): void {
    const now = Date.now();
    const msInDay = 24 * 60 * 60 * 1000;
    if (now - this.dayStart >= msInDay) {
      this.callCount = 0;
      this.dayStart = now;
    }
  }
}

// --- Zoho Client ---

let cachedClient: ZohoClient | null = null;

export function getZohoClient(): ZohoClient {
  if (cachedClient) return cachedClient;

  const clientId = process.env.ZOHO_CLIENT_ID;
  const clientSecret = process.env.ZOHO_CLIENT_SECRET;
  const refreshToken = process.env.ZOHO_REFRESH_TOKEN;
  const apiBase = process.env.ZOHO_API_BASE_URL || "https://www.zohoapis.com/crm/v2";
  const accountsUrl = process.env.ZOHO_ACCOUNTS_URL || "https://accounts.zoho.com";
  const dailyLimit = parseInt(process.env.ZOHO_DAILY_API_LIMIT || "2000", 10);

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "[ZOHO] Missing env vars: ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN"
    );
  }

  cachedClient = new ZohoClient({
    clientId,
    clientSecret,
    refreshToken,
    apiBase,
    accountsUrl,
    dailyLimit,
  });

  return cachedClient;
}

interface ZohoClientConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  apiBase: string;
  accountsUrl: string;
  dailyLimit: number;
}

export class ZohoClient {
  private config: ZohoClientConfig;
  private accessToken: string | null = null;
  private tokenExpiry = 0;
  private rateLimiter: RateLimiter;

  constructor(config: ZohoClientConfig) {
    this.config = config;
    this.rateLimiter = new RateLimiter(config.dailyLimit);
  }

  // --- Token Management ---

  async getAccessToken(): Promise<string> {
    // Return cached token if still valid (with 5 min buffer)
    if (this.accessToken && Date.now() < this.tokenExpiry - 5 * 60 * 1000) {
      return this.accessToken;
    }

    const params = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      refresh_token: this.config.refreshToken,
    });

    const res = await fetch(
      `${this.config.accountsUrl}/oauth/v2/token`,
      { method: "POST", body: params }
    );

    if (!res.ok) {
      throw new Error(`[ZOHO] Token refresh failed: ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as ZohoTokenResponse;

    if (data.error) {
      throw new Error(`[ZOHO] Token refresh error: ${data.error}`);
    }

    this.accessToken = data.access_token;
    this.tokenExpiry = Date.now() + data.expires_in * 1000;

    return this.accessToken;
  }

  // --- Rate Limit Info ---

  getCallsToday(): number {
    return this.rateLimiter.getCallsToday();
  }

  getRemainingCalls(): number {
    return this.rateLimiter.getRemainingCalls();
  }

  getDailyLimit(): number {
    return this.config.dailyLimit;
  }

  // --- Core API Methods ---

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    if (!this.rateLimiter.canMakeCall()) {
      throw new Error(
        `[ZOHO] Daily API rate limit reached (${this.config.dailyLimit}). Retry tomorrow.`
      );
    }

    const token = await this.getAccessToken();

    const res = await fetch(`${this.config.apiBase}${path}`, {
      method,
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    this.rateLimiter.recordCall();

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(
        `[ZOHO] API ${method} ${path} failed: ${res.status} — ${errorText}`
      );
    }

    // Some endpoints return 204 No Content
    if (res.status === 204) return {} as T;

    return (await res.json()) as T;
  }

  /**
   * GET records from a module with optional filters.
   * Supports pagination and modified_since for incremental sync.
   */
  async getRecords(
    module: string,
    options: {
      page?: number;
      perPage?: number;
      modifiedSince?: string; // ISO 8601 datetime
      fields?: string[];
    } = {}
  ): Promise<ZohoRecordResponse> {
    const params = new URLSearchParams();
    if (options.page) params.set("page", String(options.page));
    params.set("per_page", String(options.perPage || 200));
    if (options.fields?.length) params.set("fields", options.fields.join(","));

    const headers: Record<string, string> = {};
    if (options.modifiedSince) {
      headers["If-Modified-Since"] = options.modifiedSince;
    }

    if (!this.rateLimiter.canMakeCall()) {
      throw new Error("[ZOHO] Daily API rate limit reached.");
    }

    const token = await this.getAccessToken();

    const res = await fetch(
      `${this.config.apiBase}/${module}?${params.toString()}`,
      {
        method: "GET",
        headers: {
          Authorization: `Zoho-oauthtoken ${token}`,
          ...headers,
        },
      }
    );

    this.rateLimiter.recordCall();

    // 304 Not Modified — no changes since the given date
    if (res.status === 304) {
      return { data: [], info: { per_page: 200, count: 0, page: 1, more_records: false } };
    }

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`[ZOHO] GET /${module} failed: ${res.status} — ${errorText}`);
    }

    return (await res.json()) as ZohoRecordResponse;
  }

  /**
   * Upsert (insert or update) records in a module.
   * Max 100 records per call. Uses duplicate_check_fields for matching.
   */
  async upsertRecords(
    module: string,
    records: ZohoRecord[],
    duplicateCheckFields?: string[]
  ): Promise<ZohoUpsertResponse> {
    if (records.length === 0) {
      return { data: [] };
    }

    // Zoho max 100 records per upsert call
    if (records.length > 100) {
      throw new Error(`[ZOHO] Max 100 records per upsert, got ${records.length}`);
    }

    const body: Record<string, unknown> = { data: records };
    if (duplicateCheckFields?.length) {
      body.duplicate_check_fields = duplicateCheckFields;
    }

    return this.request<ZohoUpsertResponse>("POST", `/${module}/upsert`, body);
  }

  /**
   * Get a single record by ID.
   */
  async getRecord(module: string, recordId: string): Promise<ZohoRecord | null> {
    try {
      const result = await this.request<ZohoRecordResponse>(
        "GET",
        `/${module}/${recordId}`
      );
      return result.data?.[0] || null;
    } catch (err) {
      // 204 = record not found
      if (err instanceof Error && err.message.includes("204")) return null;
      throw err;
    }
  }

  /**
   * Search records by criteria.
   * Criteria format: "(Email:equals:test@example.com)"
   */
  async searchRecords(
    module: string,
    criteria: string,
    page = 1
  ): Promise<ZohoRecordResponse> {
    const params = new URLSearchParams({
      criteria,
      page: String(page),
      per_page: "200",
    });

    return this.request<ZohoRecordResponse>(
      "GET",
      `/${module}/search?${params.toString()}`
    );
  }

  /**
   * Get all records from a module, handling pagination automatically.
   * Use with caution on large modules — respects rate limits.
   * maxPages limits how many pages to fetch per call (for cron budget).
   */
  async getAllRecords(
    module: string,
    options: {
      modifiedSince?: string;
      fields?: string[];
      maxPages?: number;
    } = {}
  ): Promise<{ records: ZohoRecord[]; hasMore: boolean; lastPage: number }> {
    const maxPages = options.maxPages || 5;
    const allRecords: ZohoRecord[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore && page <= maxPages) {
      if (!this.rateLimiter.canMakeCall()) {
        return { records: allRecords, hasMore: true, lastPage: page - 1 };
      }

      const result = await this.getRecords(module, {
        page,
        perPage: 200,
        modifiedSince: options.modifiedSince,
        fields: options.fields,
      });

      allRecords.push(...result.data);
      hasMore = result.info.more_records;
      page++;
    }

    return { records: allRecords, hasMore, lastPage: page - 1 };
  }
}
