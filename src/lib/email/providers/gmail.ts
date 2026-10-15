// Proveedor Gmail (#885): adapta lo que ya existía de GW-1 (lib/google/*) a `EmailProvider`.
// No reimplementa nada: envío, alias y registro siguen viviendo en lib/google/gmail.ts.
import { sendGmail, logOutboundSend, listSendAsAddresses } from "@/lib/google/gmail"
import { getConnectionStatus, GWNotConnectedError } from "@/lib/google/workspace.service"
import { CorreoNoConectadoError, type EmailProvider } from "./types"

/** Texto plano corto a partir del HTML, para el resumen en el historial. */
export function htmlToSnippet(html: string): string {
  const text = html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  return text.length > 160 ? text.slice(0, 157) + "…" : text
}

export const gmailProvider: EmailProvider = {
  id: "gmail",
  nombre: "Gmail",
  urlConectar: "/settings?tab=google",

  async conexion(userId) {
    const s = await getConnectionStatus(userId) // nunca lanza
    if (!s.connected) return { conectado: false, requiereReconexion: false }
    return { conectado: true, requiereReconexion: s.isValid === false, cuenta: s.googleEmail }
  },

  remitentes(userId) {
    return listSendAsAddresses(userId) // degrada a [] si falta scope o no hay conexión
  },

  async enviar(envio) {
    // Remitente: solo se honra si está entre los verificados; si no, sendGmail usa la cuenta.
    let from: string | undefined
    if (envio.from) {
      const pedido = envio.from.trim().toLowerCase()
      const sendAs = await listSendAsAddresses(envio.userId)
      if (sendAs.some((s) => s.email === pedido)) from = pedido
    }
    try {
      const sent = await sendGmail({
        userId: envio.userId,
        to: envio.to,
        subject: envio.subject,
        html: envio.html,
        from,
        threadId: envio.threadId,
      })
      await logOutboundSend({
        userId: envio.userId,
        contactId: envio.contactId,
        dealId: envio.dealId ?? null,
        messageId: sent.messageId,
        threadId: sent.threadId,
        subject: envio.subject,
        snippet: htmlToSnippet(envio.html),
      })
      return sent
    } catch (e) {
      if (e instanceof GWNotConnectedError) throw new CorreoNoConectadoError(e.message)
      throw e
    }
  },
}
