// src/app/api/google/oauth/connect/route.ts
import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { randomBytes } from "crypto"
import { getServerSession } from "@/lib/auth/session"
import { buildConsentUrl } from "@/lib/google/workspace.service"

export const dynamic = "force-dynamic"

export async function GET() {
  const session = await getServerSession()
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

  const state = randomBytes(24).toString("hex")
  cookies().set("g_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  })

  try {
    return NextResponse.redirect(buildConsentUrl(state))
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Config Google incompleta" }, { status: 500 })
  }
}
