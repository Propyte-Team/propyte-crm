// GET /api/email/remitentes (#885): remitentes que acepta la cuenta del usuario, para el
// selector «Desde» del compositor. [] si no hay cuenta conectada o el proveedor no los da.
import { NextResponse } from "next/server"
import { getServerSession } from "@/lib/auth/session"
import { resolverCorreoDelUsuario } from "@/lib/email/providers"

export const dynamic = "force-dynamic"

export async function GET() {
  const session = await getServerSession()
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  const { provider } = await resolverCorreoDelUsuario(session.user.id)
  const data = provider ? await provider.remitentes(session.user.id) : []
  return NextResponse.json({ data })
}
