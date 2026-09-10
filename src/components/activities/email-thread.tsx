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
            // Auditoría 2026-09-10: segunda capa. El HTML ya viene saneado del servidor
            // (lib/email/sanitize.ts, aplicado en getThreadMessages), pero se pinta dentro
            // de un iframe con `sandbox` VACÍO — sin allow-scripts, sin allow-same-origin,
            // sin allow-forms. Un sandbox así no ejecuta nada: ni `<script>`, ni
            // `onerror`, ni `javascript:`. Si algún día alguien sirve HTML por otra ruta
            // sin pasar por el saneador, esto sigue conteniéndolo.
            //
            // `srcDoc` y no `src`: el contenido va inline, no hay petición que interceptar.
            // Altura fija porque con el sandbox vacío el documento de dentro no puede
            // mandar su alto por postMessage — y el diseño ya acotaba a max-h-64.
            <iframe
              sandbox=""
              srcDoc={`<!doctype html><meta charset="utf-8"><base target="_blank"><style>html,body{margin:0;padding:0;font:12px system-ui,-apple-system,sans-serif;color:#404040;overflow-wrap:break-word}img{max-width:100%;height:auto}a{color:inherit;text-decoration:underline}table{max-width:100%}</style>${m.bodyHtml}`}
              title={`Cuerpo del correo: ${m.subject || "(sin asunto)"}`}
              className="mt-1.5 h-64 w-full border-0 bg-white"
              loading="lazy"
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
