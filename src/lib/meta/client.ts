// ============================================================
// Meta Graph API Client — TypeScript port from meta-ads-mcp
// ============================================================

const API_VERSION = process.env.META_API_VERSION || "v21.0"
const BASE_URL = `https://graph.facebook.com/${API_VERSION}`

export class MetaAPI {
  private accessToken: string

  constructor() {
    const token = process.env.META_ACCESS_TOKEN
    if (!token) throw new Error("META_ACCESS_TOKEN not set")
    this.accessToken = token
  }

  async request<T = Record<string, unknown>>(
    endpoint: string,
    params: Record<string, unknown> = {},
    method: "GET" | "POST" | "DELETE" = "GET"
  ): Promise<T> {
    const url = new URL(`${BASE_URL}${endpoint}`)

    if (method === "GET") {
      url.searchParams.set("access_token", this.accessToken)
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(
          key,
          typeof value === "object" ? JSON.stringify(value) : String(value)
        )
      }
    }

    const options: RequestInit = { method }

    if (method === "POST" || method === "DELETE") {
      const body = { access_token: this.accessToken, ...params }
      options.headers = { "Content-Type": "application/json" }
      options.body = JSON.stringify(body)
    }

    const res = await fetch(url.toString(), options)
    const data = await res.json()

    if (data.error) {
      throw new Error(
        `Meta API Error: ${data.error.message} (code: ${data.error.code})`
      )
    }

    return data as T
  }

  async requestAll<T = Record<string, unknown>>(
    endpoint: string,
    params: Record<string, unknown> = {},
    limit = 100
  ): Promise<T[]> {
    const allData: T[] = []
    params.limit = limit

    const firstPage = await this.request<{ data?: T[]; paging?: { next?: string } }>(
      endpoint,
      params
    )
    allData.push(...(firstPage.data || []))

    let nextUrl = firstPage.paging?.next
    while (nextUrl) {
      const res = await fetch(nextUrl)
      const data = await res.json()
      if (data.error) break
      allData.push(...(data.data || []))
      nextUrl = data.paging?.next
    }

    return allData
  }
}

// Singleton instance
let _api: MetaAPI | null = null

export function getMetaAPI(): MetaAPI {
  if (!_api) _api = new MetaAPI()
  return _api
}
