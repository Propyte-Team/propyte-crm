// src/app/api/cron/google/gmail-sync/route.ts
// Respaldo de inbound cuando Pub/Sub no está disponible (p.ej. local) o como red de seguridad.
// Agendar en Hostinger (x-cron-secret), p.ej. cada 15 min:
//   curl -s -H "x-cron-secret: $CRON_SECRET" https://crm.propyte.com/api/cron/google/gmail-sync
import { NextRequest, NextResponse } from "next/server"
import { rechazoCron } from "@/lib/cron/auth"
import prisma from "@/lib/db"
import { processGmailHistory } from "@/lib/google/gmail"

export const dynamic = "force-dynamic"
export const maxDuration = 60


export async function GET(req: NextRequest) {
  const rechazo = rechazoCron(req)
  if (rechazo) return rechazo

  const startedAt = Date.now()
  let tokens: { userId: string }[] = []
  try {
    tokens = await prisma.googleOAuthToken.findMany({ where: { isValid: true }, select: { userId: true } })
  } catch {
    // tabla aún no migrada → no-op
    return NextResponse.json({ ok: true, note: "google_oauth_tokens no disponible", accounts: 0 })
  }

  let logged = 0
  let skipped = 0
  const errors: string[] = []
  for (const t of tokens) {
    try {
      const r = await processGmailHistory(t.userId)
      logged += r.logged
      skipped += r.skipped
    } catch (e) {
      errors.push(`${t.userId}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return NextResponse.json({
    ok: true,
    accounts: tokens.length,
    logged,
    skipped,
    errors: errors.slice(0, 10),
    ms: Date.now() - startedAt,
  })
}
