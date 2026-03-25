// ============================================================
// API Route: POST /api/meta-ads/capi
// Receives CRM events and forwards them to Meta Conversions API
// ============================================================

import { NextRequest, NextResponse } from "next/server"
import { sendCAPIEvent, type CAPIEvent } from "@/lib/meta/capi"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  // Auth: verify API key or cron secret
  const authHeader = request.headers.get("authorization")
  const apiKey = process.env.CAPI_API_KEY || process.env.CRON_SECRET

  if (apiKey && authHeader !== `Bearer ${apiKey}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const body = await request.json()

    // Support single event or array of events
    const events: CAPIEvent[] = Array.isArray(body) ? body : [body]

    const results = []
    for (const event of events) {
      // Validate required fields
      if (!event.eventName || !event.actionSource || !event.userData) {
        results.push({ error: "Missing eventName, actionSource, or userData" })
        continue
      }

      const result = await sendCAPIEvent(event)
      results.push(result)
    }

    return NextResponse.json({
      ok: true,
      sentAt: new Date().toISOString(),
      results,
    })
  } catch (error) {
    console.error("[CAPI Route] Error:", error)
    return NextResponse.json(
      { error: "CAPI send failed", message: String(error) },
      { status: 500 }
    )
  }
}
