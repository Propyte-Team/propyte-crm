// GET /api/email/estado (#885): ¿con qué cuenta de correo envía el usuario, y puede ya?
// Solo lee la base (no llama a Gmail), así que es barato pedirlo al hacer clic en «Correo».
import { NextResponse } from "next/server"
import { getServerSession } from "@/lib/auth/session"
import { resolverCorreoDelUsuario } from "@/lib/email/providers"

export const dynamic = "force-dynamic"

export async function GET() {
  const session = await getServerSession()
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  const { estado } = await resolverCorreoDelUsuario(session.user.id)
  return NextResponse.json({ data: estado })
}
