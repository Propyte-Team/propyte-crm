// src/app/api/google/gmail/threads/[threadId]/route.ts
// Devuelve los mensajes de un hilo (cuerpo on-demand) para el expand inline en el timeline.
// v1 (speckit OQ4): cada asesor ve los hilos de SU propia cuenta Gmail.
import { NextResponse } from "next/server"
import { getServerSession } from "@/lib/auth/session"
import { getThreadMessages } from "@/lib/google/gmail"
import { GWNotConnectedError } from "@/lib/google/workspace.service"

export const dynamic = "force-dynamic"

export async function GET(_req: Request, { params }: { params: { threadId: string } }) {
  const session = await getServerSession()
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

  try {
    const messages = await getThreadMessages(session.user.id, params.threadId)
    return NextResponse.json({ data: { threadId: params.threadId, messages } })
  } catch (e) {
    if (e instanceof GWNotConnectedError) {
      return NextResponse.json({ error: "Cuenta Google no conectada" }, { status: 409 })
    }
    // Hilo de otro asesor / no accesible desde esta cuenta → hilo vacío (degradación suave)
    console.warn("[gmail/threads] no accesible:", e instanceof Error ? e.message : e)
    return NextResponse.json({ data: { threadId: params.threadId, messages: [] } })
  }
}
