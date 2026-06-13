// src/app/api/google/oauth/disconnect/route.ts
import { NextResponse } from "next/server"
import { getServerSession } from "@/lib/auth/session"
import { getOAuthClient } from "@/lib/google/workspace.service"
import { decryptGoogleToken } from "@/lib/crypto-google"
import prisma from "@/lib/db"

export const dynamic = "force-dynamic"

export async function DELETE() {
  const session = await getServerSession()
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

  try {
    const record = await prisma.googleOAuthToken.findUnique({ where: { userId: session.user.id } })
    if (record) {
      // Revocar en Google (best-effort)
      const refresh = decryptGoogleToken(record.refreshToken)
      if (refresh) {
        const client = getOAuthClient()
        await client.revokeToken(refresh).catch(() => {})
      }
      await prisma.googleOAuthToken.delete({ where: { userId: session.user.id } })
    }
    return NextResponse.json({ data: { ok: true } })
  } catch (e) {
    console.error("Google disconnect error:", e instanceof Error ? e.message : String(e))
    return NextResponse.json({ error: "Error al desconectar" }, { status: 500 })
  }
}
