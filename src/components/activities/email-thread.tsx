// ============================================================
// EmailThread — render on-demand de los mensajes de un hilo Gmail.
// Cuerpo fetcheado al expandir (speckit §2.6: nada de cuerpos en DB).
// ============================================================
"use client"

import { useEffect, useState } from "react"
import { format } from "date-fns"
import { es } from "date-fns/locale"

interface ThreadMessage {
  messageId: string
  from: string
  to: string
  subject: string
  bodyText: string
  bodyHtml?: string
  date: string
  direction: "INBOUND" | "OUTBOUND"
}

export function EmailThread({ threadId }: { threadId: string }) {
  const [messages, setMessages] = useState<ThreadMessage[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetch(`/api/google/gmail/threads/${encodeURIComponent(threadId)}`)
      .then((r) => r.json())
      .then((json) => {
        if (!alive) return
        if (json?.data?.messages) setMessages(json.data.messages)
        else setError(json?.error ?? "No se pudo cargar el hilo")
      })
      .catch(() => alive && setError("No se pudo cargar el hilo"))
    return () => { alive = false }
  }, [threadId])

  if (error) return <p className="mt-2 text-[12px] text-[color:var(--text-tertiary)]">{error}</p>
  if (!messages) return <p className="mt-2 text-[12px] text-[color:var(--text-tertiary)]">Cargando hilo…</p>
  if (messages.length === 0)
    return <p className="mt-2 text-[12px] text-[color:var(--text-tertiary)]">Sin mensajes accesibles en este hilo.</p>

  return (
    <div className="mt-2 space-y-2 border-l pl-3" style={{ borderColor: "var(--border-subtle)" }}>
      {messages.map((m) => (
        <div key={m.messageId} className="rounded-md border p-2.5" style={{ borderColor: "var(--border-subtle)" }}>
          <div className="flex items-center justify-between gap-2 text-[11px] text-[color:var(--text-tertiary)]">
            <span className="truncate">
              <span className="font-medium text-[color:var(--text-secondary)]">{m.direction === "OUTBOUND" ? "Yo" : m.from}</span>
              {m.direction === "OUTBOUND" && m.to ? ` → ${m.to}` : ""}
            </span>
            <span className="shrink-0">{format(new Date(m.date), "d MMM, HH:mm", { locale: es })}</span>
          </div>
          {m.bodyHtml ? (
            <div
              className="prose-email mt-1.5 max-h-64 overflow-y-auto text-[12px] text-[color:var(--text-secondary)] [&_a]:underline"
              dangerouslySetInnerHTML={{ __html: m.bodyHtml }}
            />
          ) : (
            <p className="mt-1.5 max-h-64 overflow-y-auto whitespace-pre-wrap text-[12px] text-[color:var(--text-secondary)]">
              {m.bodyText}
            </p>
          )}
        </div>
      ))}
    </div>
  )
}
