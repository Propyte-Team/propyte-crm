// src/app/api/google/gmail/send-as/route.ts
// Remitentes verificados ("Send mail as") de la cuenta Gmail del asesor, para el selector "Desde".
import { NextResponse } from "next/server"
import { getServerSession } from "@/lib/auth/session"
import { listSendAsAddresses } from "@/lib/google/gmail"

export const dynamic = "force-dynamic"

export async function GET() {
  const session = await getServerSession()
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  const addresses = await listSendAsAddresses(session.user.id) // degrada a [] si falta scope
  return NextResponse.json({ data: addresses })
}
