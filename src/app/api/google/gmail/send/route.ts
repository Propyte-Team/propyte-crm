// src/app/api/google/gmail/send/route.ts
// Envía un email desde la cuenta Gmail del asesor + loguea Activity(EMAIL_SENT) inline.
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import prisma from "@/lib/db"
import { getServerSession } from "@/lib/auth/session"
import { sendGmail, logOutboundSend, listSendAsAddresses } from "@/lib/google/gmail"
import { GWNotConnectedError } from "@/lib/google/workspace.service"

export const dynamic = "force-dynamic"

const schema = z.object({
  contactId: z.string().uuid(),
  to: z.string().email(),
  subject: z.string().min(1).max(998),
  body: z.string().min(1), // HTML permitido (rich text)
  from: z.string().email().optional(), // remitente elegido; se valida contra send-as verificados
  dealId: z.string().uuid().optional(),
  threadId: z.string().optional(), // para responder dentro de un hilo
})

/** Texto plano corto a partir del HTML, para el snippet del timeline. */
function htmlToSnippet(html: string): string {
  const text = html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  return text.length > 160 ? text.slice(0, 157) + "…" : text
}

export async function POST(req: NextRequest) {
  const session = await getServerSession()
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos", details: parsed.error.flatten() }, { status: 400 })
  }
  const { contactId, to, subject, body, from, dealId, threadId } = parsed.data

  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { id: true, doNotContact: true },
  })
  if (!contact) return NextResponse.json({ error: "Contacto no encontrado" }, { status: 404 })
  if (contact.doNotContact) return NextResponse.json({ error: "El contacto está marcado como No contactar" }, { status: 422 })

  // Remitente: solo se honra si está entre los send-as verificados; si no, sendGmail usa el primary.
  let validFrom: string | undefined
  if (from) {
    const sendAs = await listSendAsAddresses(session.user.id)
    if (sendAs.some((s) => s.email === from.toLowerCase())) validFrom = from
  }

  try {
    const sent = await sendGmail({ userId: session.user.id, to, subject, html: body, from: validFrom, threadId })
    await logOutboundSend({
      userId: session.user.id,
      contactId,
      dealId: dealId ?? null,
      messageId: sent.messageId,
      threadId: sent.threadId,
      subject,
      snippet: htmlToSnippet(body),
    })
    return NextResponse.json({ data: { messageId: sent.messageId, threadId: sent.threadId } }, { status: 201 })
  } catch (e) {
    if (e instanceof GWNotConnectedError) {
      return NextResponse.json({ error: "Conecta tu cuenta de Google en Configuración para enviar correos" }, { status: 409 })
    }
    // Nunca loguear el objeto de error de Gaxios (lleva client_secret) — solo el message
    console.error("[gmail/send] error:", e instanceof Error ? e.message : e)
    return NextResponse.json({ error: "No se pudo enviar el correo" }, { status: 500 })
  }
}
