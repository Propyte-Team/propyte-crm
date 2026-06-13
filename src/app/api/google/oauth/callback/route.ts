// src/app/api/google/oauth/callback/route.ts
import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import { google } from "googleapis"
import { getServerSession } from "@/lib/auth/session"
import { getOAuthClient } from "@/lib/google/workspace.service"
import { encryptGoogleToken } from "@/lib/crypto-google"
import prisma from "@/lib/db"

export const dynamic = "force-dynamic"

function settingsRedirect(req: NextRequest, status: string) {
  return NextResponse.redirect(new URL(`/settings?google=${status}`, req.url))
}

export async function GET(req: NextRequest) {
  const session = await getServerSession()
  if (!session?.user) return NextResponse.redirect(new URL("/login", req.url))

  const url = new URL(req.url)
  const code = url.searchParams.get("code")
  const state = url.searchParams.get("state")
  const cookieState = cookies().get("g_oauth_state")?.value
  cookies().delete("g_oauth_state")

  if (url.searchParams.get("error")) return settingsRedirect(req, "error")
  if (!code || !state || !cookieState || state !== cookieState) return settingsRedirect(req, "state_error")

  try {
    const client = getOAuthClient()
    const { tokens } = await client.getToken(code)
    if (!tokens.access_token || !tokens.refresh_token) {
      // Sin refresh_token: el usuario ya había consentido antes. Pedir reconsent.
      return settingsRedirect(req, "no_refresh")
    }
    client.setCredentials(tokens)

    // Email + historyId baseline vía Gmail (scope gmail.readonly ya concedido)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gmail = google.gmail({ version: "v1", auth: client as any })
    const profile = await gmail.users.getProfile({ userId: "me" })
    const googleEmail = profile.data.emailAddress ?? "desconocido"
    const gmailHistoryId = profile.data.historyId ? String(profile.data.historyId) : null

    const data = {
      accessToken: encryptGoogleToken(tokens.access_token)!,
      refreshToken: encryptGoogleToken(tokens.refresh_token)!,
      tokenExpiry: new Date(tokens.expiry_date ?? Date.now() + 3500_000),
      scope: tokens.scope ?? "",
      googleEmail,
      gmailHistoryId,
      isValid: true,
      connectedAt: new Date(),
      lastUsedAt: new Date(),
    }
    await prisma.googleOAuthToken.upsert({
      where: { userId: session.user.id },
      create: { userId: session.user.id, ...data },
      update: data,
    })
    return settingsRedirect(req, "connected")
  } catch (e) {
    console.error("Google OAuth callback error:", e)
    return settingsRedirect(req, "error")
  }
}
