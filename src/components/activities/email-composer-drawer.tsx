// ============================================================
// EmailComposerDrawer — slide-over para redactar y enviar un correo
// desde la cuenta Gmail del asesor. Prellena destinatario + firma.
// ============================================================
"use client"

import { useEffect, useState } from "react"
import { X, Send } from "lucide-react"
import { EmailRichText } from "./email-rich-text"

interface EmailComposerDrawerProps {
  contactId: string
  contactName: string
  contactEmail: string
  dealId?: string
  onClose: () => void
  onSent: () => void
}

export function EmailComposerDrawer({
  contactId,
  contactName,
  contactEmail,
  dealId,
  onClose,
  onSent,
}: EmailComposerDrawerProps) {
  const [to, setTo] = useState(contactEmail)
  const [subject, setSubject] = useState("")
  const [body, setBody] = useState("")
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Anexa la firma del asesor (si tiene) al abrir.
  useEffect(() => {
    let alive = true
    fetch("/api/profile")
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        const sig = json?.data?.emailSignatureHtml as string | undefined
        if (alive && sig) setBody(`<p></p><p></p>${sig}`)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

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
      body: JSON.stringify({ contactId, to: to.trim(), subject: subject.trim(), body, dealId }),
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
          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-[color:var(--text-tertiary)]">Para</label>
            <input className="form-input text-[13px]" type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="correo@ejemplo.com" />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-[color:var(--text-tertiary)]">Asunto</label>
            <input className="form-input text-[13px]" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Asunto del correo" />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-[color:var(--text-tertiary)]">Mensaje</label>
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
