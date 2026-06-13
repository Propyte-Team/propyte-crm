// src/app/api/google/oauth/status/route.ts
import { NextResponse } from "next/server"
import { getServerSession } from "@/lib/auth/session"
import { getConnectionStatus } from "@/lib/google/workspace.service"

export const dynamic = "force-dynamic"

export async function GET() {
  const session = await getServerSession()
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  const status = await getConnectionStatus(session.user.id)
  return NextResponse.json({ data: status })
}
