// src/app/api/google/gmail/webhook/route.ts
// Push de Gmail Pub/Sub. Debe ACK rápido: resuelve el asesor por email y ENCOLA el delta sync.
// Verificación opcional por token de query (GOOGLE_PUBSUB_VERIFICATION_TOKEN) — patrón estándar de Pub/Sub.
import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/db"
import { enqueueAction, dayBucket } from "@/lib/workflows/queue"

export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  // Verificación opcional (si está configurada, exigirla)
  const expected = process.env.GOOGLE_PUBSUB_VERIFICATION_TOKEN?.trim()
  if (expected) {
    const token = req.nextUrl.searchParams.get("token")?.trim()
    if (token !== expected) return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  }

  let emailAddress = ""
  try {
    const envelope = await req.json()
    const dataB64 = envelope?.message?.data as string | undefined
    if (dataB64) {
      const payload = JSON.parse(Buffer.from(dataB64, "base64").toString("utf8"))
      emailAddress = String(payload.emailAddress ?? "").toLowerCase()
    }
  } catch {
    // Cuerpo no esperado → ACK igual (Pub/Sub no reintenta) pero sin trabajo
    return NextResponse.json({ ok: true, note: "payload no parseable" })
  }

  if (!emailAddress) return NextResponse.json({ ok: true, note: "sin emailAddress" })

  const token = await prisma.googleOAuthToken.findFirst({
    where: { googleEmail: { equals: emailAddress, mode: "insensitive" }, isValid: true },
    select: { userId: true },
  })
  if (!token) return NextResponse.json({ ok: true, note: "sin asesor para ese correo" })

  // Encola el delta sync (idempotente por minuto). El worker corre processGmailHistory.
  await enqueueAction({
    actionType: "GW_GMAIL_LOG_INBOUND",
    entityType: "user",
    entityId: token.userId,
    config: { userId: token.userId },
    dedupeKey: `gmail-inbound:${token.userId}:${dayBucket(new Date())}:${new Date().getUTCHours()}:${new Date().getUTCMinutes()}`,
  })

  return NextResponse.json({ ok: true })
}
