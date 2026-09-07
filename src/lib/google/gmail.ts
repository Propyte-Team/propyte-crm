// src/lib/google/gmail.ts
// GW-1 — Gmail bidireccional. Server-side only (PG2).
//  - sendGmail: envía desde la cuenta del asesor (users.messages.send) + log inline EMAIL_SENT.
//  - processGmailHistory: delta sync (history.list) → loguea entrantes/salientes nuevos.
//  - getThreadMessages: cuerpo on-demand de un hilo (para expand inline).
// Match contacto = exacto contra Contact.email (PG: sin contactos fantasma). Respeta doNotContact (PG6).
import prisma from "@/lib/db"
import { getGmailClient } from "./workspace.service"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Gmail = any

export type EmailDirection = "INBOUND" | "OUTBOUND"

// ---------- helpers MIME ----------

/** RFC 2047 encoded-word si el texto tiene no-ASCII (asuntos con acentos/ñ). */
export function encodeHeaderWord(s: string): string {
  if (/^[\x00-\x7F]*$/.test(s)) return s
  return `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`
}

/** Extrae el email de un header tipo `Nombre <a@b.com>` o `a@b.com`. Devuelve lowercase. */
export function extractEmail(headerValue: string | undefined | null): string {
  if (!headerValue) return ""
  const m = headerValue.match(/<([^>]+)>/)
  const raw = (m ? m[1] : headerValue).trim().toLowerCase()
  return raw
}

/** Lista de emails de un header con múltiples destinatarios (To/Cc), lowercase. */
export function extractEmails(headerValue: string | undefined | null): string[] {
  if (!headerValue) return []
  return headerValue
    .split(",")
    .map((part) => extractEmail(part))
    .filter(Boolean)
}

/** Construye el mensaje RFC 2822 (HTML, UTF-8) y lo devuelve base64url para users.messages.send. */
export function buildRawEmail(opts: {
  to: string
  from: string
  subject: string
  html: string
  inReplyTo?: string
  references?: string
}): string {
  const bodyB64 = Buffer.from(opts.html, "utf8")
    .toString("base64")
    .replace(/(.{76})/g, "$1\r\n")
  const headers = [
    `To: ${opts.to}`,
    `From: ${opts.from}`,
    `Subject: ${encodeHeaderWord(opts.subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
  ]
  if (opts.inReplyTo) headers.push(`In-Reply-To: ${opts.inReplyTo}`)
  if (opts.references) headers.push(`References: ${opts.references}`)
  const raw = headers.join("\r\n") + "\r\n\r\n" + bodyB64
  return Buffer.from(raw, "utf8").toString("base64url")
}

function headerValue(headers: Array<{ name?: string | null; value?: string | null }> | undefined, name: string): string {
  const h = headers?.find((x) => (x.name ?? "").toLowerCase() === name.toLowerCase())
  return h?.value ?? ""
}

/** Decodifica recursivamente el cuerpo de un payload Gmail. Devuelve {text, html}. */
export function extractBody(payload: unknown): { text: string; html: string } {
  let text = ""
  let html = ""
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function walk(part: any) {
    if (!part) return
    const mime = part.mimeType as string | undefined
    const data = part.body?.data as string | undefined
    if (data && (mime === "text/plain" || mime === "text/html")) {
      const decoded = Buffer.from(data, "base64url").toString("utf8")
      if (mime === "text/plain") text += decoded
      else html += decoded
    }
    for (const p of part.parts ?? []) walk(p)
  }
  walk(payload)
  return { text, html }
}

// ---------- envío ----------

export async function sendGmail(opts: {
  userId: string
  to: string
  subject: string
  html: string
  from?: string // remitente elegido (ya validado contra send-as por la ruta); default = cuenta conectada
  threadId?: string
}): Promise<{ messageId: string; threadId: string; from: string }> {
  const record = await prisma.googleOAuthToken.findUnique({
    where: { userId: opts.userId },
    select: { googleEmail: true },
  })
  const from = opts.from?.trim() || record?.googleEmail || "me"
  const gmail: Gmail = await getGmailClient(opts.userId)
  const raw = buildRawEmail({ to: opts.to, from, subject: opts.subject, html: opts.html })
  const res = await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw, threadId: opts.threadId },
  })
  return { messageId: res.data.id as string, threadId: res.data.threadId as string, from }
}

export interface SendAsAddress {
  email: string
  name: string
  isPrimary: boolean
  isDefault: boolean
}

/** Remitentes verificados de la cuenta ("Send mail as"). Degrada a [] si falta scope/no conectado. */
export async function listSendAsAddresses(userId: string): Promise<SendAsAddress[]> {
  try {
    const gmail: Gmail = await getGmailClient(userId)
    const res = await gmail.users.settings.sendAs.list({ userId: "me" })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const all = (res.data.sendAs ?? []) as any[]
    return all
      // Solo los que Google aceptará: primary o verificados.
      .filter((s) => s.isPrimary || s.verificationStatus === "accepted")
      .map((s) => ({
        email: String(s.sendAsEmail ?? "").toLowerCase(),
        name: String(s.displayName ?? ""),
        isPrimary: Boolean(s.isPrimary),
        isDefault: Boolean(s.isDefault),
      }))
      .filter((s) => s.email)
  } catch (e) {
    console.warn("[gmail] sendAs.list no disponible (scope/no conectado):", e instanceof Error ? e.message : e)
    return []
  }
}

/** Resuelve variables {{contact.*}} de una plantilla y descarta líneas con variables sin resolver (J.2). */
export function renderEmailTemplate(
  text: string,
  contact: { firstName?: string | null; lastName?: string | null },
): string {
  const vars: Record<string, string> = {
    "contact.firstName": contact.firstName ?? "",
    "contact.lastName": contact.lastName ?? "",
  }
  let out = text
  for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{{${k}}}`, v)
  // Líneas con variables sin resolver → fuera (nunca enviar {{...}} crudo)
  return out
    .split("\n")
    .filter((line) => !/\{\{[^}]+\}\}/.test(line))
    .join("\n")
}

// ---------- log de actividad + upsert de hilo ----------

interface ParsedEmail {
  messageId: string
  threadId: string
  subject: string
  snippet: string
  date: Date
  direction: EmailDirection
  fromEmail: string
  toEmails: string[]
}

/** Resuelve el contacto por el email de la contraparte (no el del asesor). Match exacto. */
async function resolveContact(parsed: ParsedEmail) {
  const candidates =
    parsed.direction === "INBOUND" ? [parsed.fromEmail] : parsed.toEmails
  for (const email of candidates) {
    if (!email) continue
    const contact = await prisma.contact.findFirst({
      where: { email: { equals: email, mode: "insensitive" }, deletedAt: null },
      select: { id: true, doNotContact: true },
    })
    if (contact) return contact
  }
  return null
}

/** Crea Activity(EMAIL_*) + upsert GmailThread. Idempotente por gmailMessageId. */
async function persistEmail(userId: string, parsed: ParsedEmail): Promise<boolean> {
  // Dedup: ya logueado este messageId
  const dup = await prisma.activity.findUnique({
    where: { gmailMessageId: parsed.messageId },
    select: { id: true },
  })
  if (dup) return false

  const contact = await resolveContact(parsed)
  if (!contact) return false // sin match → no creamos contactos fantasma
  if (contact.doNotContact) return false // PG6

  await prisma.activity.create({
    data: {
      contactId: contact.id,
      userId,
      activityType: parsed.direction === "INBOUND" ? "EMAIL_RECEIVED" : "EMAIL_SENT",
      subject: parsed.subject || "(sin asunto)",
      description: parsed.snippet || null,
      status: "COMPLETADA",
      completedAt: parsed.date,
      createdAt: parsed.date, // ordena el timeline por la fecha real del correo
      gmailThreadId: parsed.threadId,
      gmailMessageId: parsed.messageId,
    },
  })

  await upsertThread(userId, contact.id, parsed)
  return true
}

async function upsertThread(userId: string, contactId: string, parsed: ParsedEmail) {
  const existing = await prisma.gmailThread.findUnique({
    where: { userId_threadId: { userId, threadId: parsed.threadId } },
  })
  if (existing) {
    const direction = existing.direction === parsed.direction ? parsed.direction : "MIXED"
    await prisma.gmailThread.update({
      where: { userId_threadId: { userId, threadId: parsed.threadId } },
      data: {
        messageCount: { increment: 1 },
        lastMessageAt: parsed.date,
        snippet: parsed.snippet,
        subject: existing.subject ?? parsed.subject,
        direction,
      },
    })
  } else {
    await prisma.gmailThread.create({
      data: {
        userId,
        contactId,
        threadId: parsed.threadId,
        subject: parsed.subject || null,
        snippet: parsed.snippet || null,
        lastMessageAt: parsed.date,
        direction: parsed.direction,
        messageCount: 1,
      },
    })
  }
}

/** Loguea inmediatamente un saliente recién enviado, con el contactId ya conocido del request. */
export async function logOutboundSend(opts: {
  userId: string
  contactId: string
  dealId?: string | null
  messageId: string
  threadId: string
  subject: string
  snippet: string
}): Promise<boolean> {
  const dup = await prisma.activity.findUnique({ where: { gmailMessageId: opts.messageId }, select: { id: true } })
  if (dup) return false
  await prisma.activity.create({
    data: {
      contactId: opts.contactId,
      dealId: opts.dealId ?? null,
      userId: opts.userId,
      activityType: "EMAIL_SENT",
      subject: opts.subject || "(sin asunto)",
      description: opts.snippet || null,
      status: "COMPLETADA",
      completedAt: new Date(),
      gmailThreadId: opts.threadId,
      gmailMessageId: opts.messageId,
    },
  })
  await upsertThread(opts.userId, opts.contactId, {
    messageId: opts.messageId,
    threadId: opts.threadId,
    subject: opts.subject,
    snippet: opts.snippet,
    date: new Date(),
    direction: "OUTBOUND",
    fromEmail: "",
    toEmails: [],
  })
  // Propaga el dealId al hilo si el create previo lo dejó null
  if (opts.dealId) {
    await prisma.gmailThread
      .update({
        where: { userId_threadId: { userId: opts.userId, threadId: opts.threadId } },
        data: { dealId: opts.dealId },
      })
      .catch(() => {})
  }
  // #731: el correo que el asesor manda es un toque saliente real y detiene su reloj de
  // SLA. Va después del dedup de arriba a propósito: un mismo correo relogueado no debe
  // volver a cerrar nada.
  const { meetSlaTimers } = await import("@/lib/workflows/sla")
  await meetSlaTimers(opts.contactId)
  return true
}

/** Fetch de un mensaje por id (metadata + snippet) y log. Devuelve true si lo registró. */
export async function logGmailMessageById(
  userId: string,
  messageId: string,
  gmailClient?: Gmail,
  ownerEmail?: string,
): Promise<boolean> {
  // Dedup temprano para ahorrar un round-trip a Gmail
  const dup = await prisma.activity.findUnique({ where: { gmailMessageId: messageId }, select: { id: true } })
  if (dup) return false

  const gmail: Gmail = gmailClient ?? (await getGmailClient(userId))
  let owner = ownerEmail
  if (!owner) {
    const rec = await prisma.googleOAuthToken.findUnique({ where: { userId }, select: { googleEmail: true } })
    owner = rec?.googleEmail ?? ""
  }
  const res = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "metadata",
    metadataHeaders: ["From", "To", "Subject", "Date"],
  })
  const headers = res.data.payload?.headers
  const fromEmail = extractEmail(headerValue(headers, "From"))
  const toEmails = extractEmails(headerValue(headers, "To"))
  const subject = headerValue(headers, "Subject")
  const dateHeader = headerValue(headers, "Date")
  const internalMs = res.data.internalDate ? Number(res.data.internalDate) : undefined
  const date = internalMs ? new Date(internalMs) : dateHeader ? new Date(dateHeader) : new Date()
  const direction: EmailDirection = fromEmail && owner && fromEmail === owner.toLowerCase() ? "OUTBOUND" : "INBOUND"

  return persistEmail(userId, {
    messageId,
    threadId: res.data.threadId as string,
    subject,
    snippet: (res.data.snippet as string) ?? "",
    date,
    direction,
    fromEmail,
    toEmails,
  })
}

/** Delta sync por asesor: history.list desde el baseline; primer run solo fija baseline. */
export async function processGmailHistory(userId: string): Promise<{ logged: number; skipped: number }> {
  const record = await prisma.googleOAuthToken.findUnique({ where: { userId } })
  if (!record || !record.isValid) return { logged: 0, skipped: 0 }

  const gmail: Gmail = await getGmailClient(userId)
  const owner = record.googleEmail
  let messageIds: string[] = []

  if (record.gmailHistoryId) {
    try {
      let pageToken: string | undefined
      do {
        const hist = await gmail.users.history.list({
          userId: "me",
          startHistoryId: record.gmailHistoryId,
          historyTypes: ["messageAdded"],
          pageToken,
        })
        for (const h of hist.data.history ?? []) {
          for (const m of h.messagesAdded ?? []) {
            if (m.message?.id) messageIds.push(m.message.id as string)
          }
        }
        pageToken = hist.data.nextPageToken as string | undefined
      } while (pageToken)
    } catch (e: unknown) {
      // historyId demasiado viejo (404) → re-baseline sin backfill masivo
      console.warn("[gmail] history.list falló, re-baseline:", e instanceof Error ? e.message : e)
      messageIds = []
    }
  }
  // Primer run (sin historyId): no se hace backfill; solo se fija el baseline abajo.

  messageIds = [...new Set(messageIds)]
  let logged = 0
  let skipped = 0
  for (const id of messageIds) {
    try {
      const ok = await logGmailMessageById(userId, id, gmail, owner)
      ok ? logged++ : skipped++
    } catch (e) {
      skipped++
      console.warn("[gmail] log de mensaje falló:", id, e instanceof Error ? e.message : e)
    }
  }

  // Avanza el baseline al historyId actual del buzón
  try {
    const prof = await gmail.users.getProfile({ userId: "me" })
    if (prof.data.historyId) {
      await prisma.googleOAuthToken.update({
        where: { userId },
        data: { gmailHistoryId: String(prof.data.historyId), lastUsedAt: new Date() },
      })
    }
  } catch {
    /* no-op: el baseline se reintenta en el próximo tick */
  }

  return { logged, skipped }
}

// ---------- expand de hilo (cuerpo on-demand) ----------

export interface ThreadMessage {
  messageId: string
  from: string
  to: string
  subject: string
  bodyText: string
  bodyHtml?: string
  date: string
  direction: EmailDirection
}

export async function getThreadMessages(userId: string, threadId: string): Promise<ThreadMessage[]> {
  const rec = await prisma.googleOAuthToken.findUnique({ where: { userId }, select: { googleEmail: true } })
  const owner = (rec?.googleEmail ?? "").toLowerCase()
  const gmail: Gmail = await getGmailClient(userId)
  const res = await gmail.users.threads.get({ userId: "me", id: threadId, format: "full" })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (res.data.messages ?? []).map((msg: any) => {
    const headers = msg.payload?.headers
    const fromEmail = extractEmail(headerValue(headers, "From"))
    const { text, html } = extractBody(msg.payload)
    const internalMs = msg.internalDate ? Number(msg.internalDate) : Date.parse(headerValue(headers, "Date"))
    return {
      messageId: msg.id as string,
      from: headerValue(headers, "From"),
      to: headerValue(headers, "To"),
      subject: headerValue(headers, "Subject"),
      bodyText: text,
      bodyHtml: html || undefined,
      date: new Date(internalMs || Date.now()).toISOString(),
      direction: (fromEmail && fromEmail === owner ? "OUTBOUND" : "INBOUND") as EmailDirection,
    }
  })
}
