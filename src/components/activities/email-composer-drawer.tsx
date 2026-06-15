// ============================================================
// EmailComposerDrawer — slide-over para redactar y enviar un correo
// desde la cuenta Gmail del asesor. Remitente (send-as verificado),
// plantillas (con variables), firma y destinatario prellenados.
// ============================================================
"use client"

import { useEffect, useState } from "react"
import { X, Send } from "lucide-react"
import { EmailRichText } from "./email-rich-text"

interface EmailComposerDrawerProps {
  contactId: string
  contactName: string
  contactEmail: string
  contactFirstName?: string
  contactLastName?: string
  dealId?: string
  onClose: () => void
  onSent: () => void
}

interface SendAsAddress {
  email: string
  name: string
  isPrimary: boolean
  isDefault: boolean
}

interface EmailTemplate {
  id: string
  name: string
  subject?: string | null
  body: string
  channel: string
}

/** Resuelve {{contact.*}} y descarta líneas con variables sin resolver (espejo client de renderEmailTemplate). */
function renderVars(text: string, firstName?: string, lastName?: string): string {
  const out = text
    .replaceAll("{{contact.firstName}}", firstName ?? "")
    .replaceAll("{{contact.lastName}}", lastName ?? "")
  return out
    .split("\n")
    .filter((line) => !/\{\{[^}]+\}\}/.test(line))
    .join("\n")
}

export function EmailComposerDrawer({
  contactId,
  contactName,
  contactEmail,
  contactFirstName,
  contactLastName,
  dealId,
  onClose,
  onSent,
}: EmailComposerDrawerProps) {
  const [to, setTo] = useState(contactEmail)
  const [subject, setSubject] = useState("")
  const [body, setBody] = useState("")
  const [signature, setSignature] = useState("")
  const [sendAs, setSendAs] = useState<SendAsAddress[]>([])
  const [from, setFrom] = useState<string>("")
  const [templates, setTemplates] = useState<EmailTemplate[]>([])
  const [templateId, setTemplateId] = useState<string>("")
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Carga inicial: firma + alias preferido (perfil), remitentes verificados, plantillas EMAIL.
  useEffect(() => {
    let alive = true
    Promise.all([
      fetch("/api/profile").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch("/api/google/gmail/send-as").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch("/api/profile/templates").then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([profile, sendAsRes, tplRes]) => {
      if (!alive) return
      const sig = profile?.data?.emailSignatureHtml as string | undefined
      if (sig) {
        setSignature(sig)
        setBody(`<p></p><p></p>${sig}`)
      }
      const preferredAlias = (profile?.data?.emailFromAlias as string | undefined)?.toLowerCase()
      const addresses = (sendAsRes?.data ?? []) as SendAsAddress[]
      setSendAs(addresses)
      // Default: alias preferido si está verificado, si no el isDefault, si no el primary, si no el primero.
      const pick =
        addresses.find((a) => a.email === preferredAlias) ??
        addresses.find((a) => a.isDefault) ??
        addresses.find((a) => a.isPrimary) ??
        addresses[0]
      if (pick) setFrom(pick.email)
      const tpls = ((tplRes?.data ?? []) as EmailTemplate[]).filter((t) => t.channel === "EMAIL")
      setTemplates(tpls)
    })
    return () => {
      alive = false
    }
  }, [])

  function applyTemplate(id: string) {
    setTemplateId(id)
    const tpl = templates.find((t) => t.id === id)
    if (!tpl) return
    setSubject(renderVars(tpl.subject ?? "", contactFirstName, contactLastName))
    const rendered = renderVars(tpl.body, contactFirstName, contactLastName)
    setBody(signature ? `${rendered}<p></p>${signature}` : rendered)
  }

  async function send() {
    setError(null)
    if (!to.trim() || !subject.trim()) {
      setError("Destinatario y asunto son obligatorios")
      return
    }
    setSending(true)
    const res = await fetch("/api/google/gmail/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contactId,
        to: to.trim(),
        subject: subject.trim(),
        body,
        from: from || undefined,
        dealId,
      }),
    })
    setSending(false)
    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      setError((json as { error?: string }).error ?? "No se pudo enviar el correo")
      return
    }
    onSent()
    onClose()
  }

  const labelCls =
    "mb-1 block text-[11px] font-medium uppercase tracking-wide text-[color:var(--text-tertiary)]"

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-xl flex-col border-l"
        style={{ background: "var(--bg-card)", borderColor: "var(--border-default)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b px-5 py-3" style={{ borderColor: "var(--border-subtle)" }}>
          <div>
            <h3 className="text-[15px] font-medium text-[color:var(--text-primary)]">Enviar email</h3>
            <p className="text-[11px] text-[color:var(--text-tertiary)]">Para {contactName || "el contacto"}</p>
          </div>
          <button className="text-[color:var(--text-tertiary)] hover:text-[color:var(--text-primary)]" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {error && <p className="text-[12px]" style={{ color: "var(--color-error, #DC2626)" }}>{error}</p>}

          {/* Desde — solo si hay más de un remitente verificado */}
          {sendAs.length > 1 && (
            <div>
              <label className={labelCls}>Desde</label>
              <select className="form-input text-[13px]" value={from} onChange={(e) => setFrom(e.target.value)}>
                {sendAs.map((a) => (
                  <option key={a.email} value={a.email}>
                    {a.name ? `${a.name} <${a.email}>` : a.email}
                    {a.isPrimary ? " · principal" : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Plantilla — solo si el asesor tiene plantillas EMAIL */}
          {templates.length > 0 && (
            <div>
              <label className={labelCls}>Plantilla</label>
              <select className="form-input text-[13px]" value={templateId} onChange={(e) => applyTemplate(e.target.value)}>
                <option value="">— Sin plantilla —</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className={labelCls}>Para</label>
            <input className="form-input text-[13px]" type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="correo@ejemplo.com" />
          </div>
          <div>
            <label className={labelCls}>Asunto</label>
            <input className="form-input text-[13px]" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Asunto del correo" />
          </div>
          <div>
            <label className={labelCls}>Mensaje</label>
            <EmailRichText value={body} onChange={setBody} placeholder="Escribe tu mensaje…" />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t px-5 py-3" style={{ borderColor: "var(--border-subtle)" }}>
          <button className="btn-secondary text-[13px]" onClick={onClose} disabled={sending}>Cancelar</button>
          <button className="btn-primary text-[13px]" onClick={send} disabled={sending}>
            <Send className="h-3.5 w-3.5" /> {sending ? "Enviando…" : "Enviar"}
          </button>
        </div>
      </div>
    </div>
  )
}
