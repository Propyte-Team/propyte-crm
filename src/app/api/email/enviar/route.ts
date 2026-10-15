// POST /api/email/enviar (#885): envía un correo al contacto desde la cuenta del asesor
// (el proveedor que tenga conectado) y lo deja en su historial.
//
// Antes vivía en /api/google/gmail/send, atado a Gmail; esa ruta queda como alias de esta.
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import prisma from "@/lib/db"
import { getServerSession } from "@/lib/auth/session"
import { puedeTocarRecord } from "@/lib/rbac/record-access"
import { CorreoNoConectadoError, resolverCorreoDelUsuario } from "@/lib/email/providers"

export const dynamic = "force-dynamic"

const schema = z.object({
  contactId: z.string().uuid(),
  to: z.string().email(),
  subject: z.string().min(1).max(998),
  body: z.string().min(1), // HTML permitido (rich text)
  from: z.string().email().optional(), // remitente elegido; el proveedor lo valida
  dealId: z.string().uuid().optional(),
  threadId: z.string().optional(), // para responder dentro de un hilo
})

const MSG_CONECTAR = "Conecta tu cuenta de correo en Mi Configuración para enviar correos"

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

  // #885: misma regla que el botón Llamar (#761). Tener sesión no es permiso para escribirle
  // a cualquier contacto ni para colgarle un correo al historial de un negocio ajeno.
  // Mismo 404 que si no existiera: un 403 confirmaría que sí está.
  if (!(await puedeTocarRecord("contact", contactId, session.user, "editar"))) {
    return NextResponse.json({ error: "Contacto no encontrado" }, { status: 404 })
  }
  if (dealId && !(await puedeTocarRecord("deal", dealId, session.user, "editar"))) {
    return NextResponse.json({ error: "Negocio no encontrado" }, { status: 404 })
  }

  if (contact.doNotContact) {
    return NextResponse.json({ error: "El contacto está marcado como No contactar" }, { status: 422 })
  }

  const { provider, estado } = await resolverCorreoDelUsuario(session.user.id)
  if (!provider || !estado.conectado || estado.requiereReconexion) {
    return NextResponse.json({ error: MSG_CONECTAR, estado }, { status: 409 })
  }

  try {
    const sent = await provider.enviar({
      userId: session.user.id,
      contactId,
      dealId: dealId ?? null,
      to,
      subject,
      html: body,
      from,
      threadId,
    })
    return NextResponse.json(
      { data: { messageId: sent.messageId, threadId: sent.threadId, proveedor: provider.id } },
      { status: 201 },
    )
  } catch (e) {
    if (e instanceof CorreoNoConectadoError) {
      return NextResponse.json({ error: MSG_CONECTAR }, { status: 409 })
    }
    // Nunca loguear el objeto de error de Gaxios (lleva client_secret) — solo el message
    console.error(`[email/enviar:${provider.id}] error:`, e instanceof Error ? e.message : e)
    return NextResponse.json({ error: "No se pudo enviar el correo" }, { status: 500 })
  }
}
