// ============================================================
// ActivityLog — compositor + timeline interactivo, estilo B/N.
// Compartido por el detalle de contacto y el de deal.
// Fetchea sus propias actividades (por contactId o dealId) y refresca tras mutar.
// ============================================================
"use client"

import { useCallback, useEffect, useState } from "react"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import {
  Send, Plus, Check, Pencil, Trash2,
  Phone, MessageSquare, Mail, Users, ClipboardCheck,
  FileText, Bell, StickyNote, CheckSquare, MapPin, FileSignature, Trophy,
  ChevronDown, ChevronRight,
  type LucideIcon,
} from "lucide-react"
import { ACTIVITY_TYPE_LABELS } from "@/lib/constants"
import { ActivityLogForm, type ActivityForEdit } from "./activity-log-form"
import { EmailComposerDrawer } from "./email-composer-drawer"
import { EmailThread } from "./email-thread"
import { CallButton } from "@/components/voice/call-button"

const TYPE_ICON: Record<string, LucideIcon> = {
  CALL_OUTBOUND: Phone, CALL_INBOUND: Phone,
  WHATSAPP_OUT: MessageSquare, WHATSAPP_IN: MessageSquare,
  SMS_OUT: MessageSquare, SMS_IN: MessageSquare,
  EMAIL_SENT: Mail, EMAIL_RECEIVED: Mail,
  MEETING_VIRTUAL: Users, MEETING_PRESENTIAL: Users, MEETING_SHOWROOM: Users,
  DISCOVERY_CALL: ClipboardCheck, PROPOSAL_DELIVERY: FileText,
  FOLLOW_UP: Bell, WALK_IN: MapPin, NOTE: StickyNote, TASK: CheckSquare, CALL_TASK: Phone,
  CONTRACT_REVIEW: FileSignature, CLOSING_ACTIVITY: Trophy,
}

interface Activity {
  id: string
  activityType: string
  subject: string
  description?: string | null
  createdAt: string
  dueDate?: string | null
  completedAt?: string | null
  status: string
  outcome?: string | null
  duration_minutes?: number | null
  gmailThreadId?: string | null
  recordingUrl?: string | null
  user?: { name: string } | null
}

interface ActivityLogProps {
  contactId: string
  contactName: string
  contactEmail?: string
  contactFirstName?: string
  contactLastName?: string
  contactPhone?: string
  doNotContact?: boolean
  currentUserId?: string
  dealId?: string
  onChanged?: () => void
}

function fmt(d: string): string {
  return format(new Date(d), "d MMM yyyy, HH:mm", { locale: es })
}

export function ActivityLog({ contactId, contactName, contactEmail, contactFirstName, contactLastName, contactPhone, doNotContact, currentUserId, dealId, onChanged }: ActivityLogProps) {
  const [activities, setActivities] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)
  const [note, setNote] = useState("")
  const [savingNote, setSavingNote] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<ActivityForEdit | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [gmailConnected, setGmailConnected] = useState(false)
  const [showComposer, setShowComposer] = useState(false)
  const [openThread, setOpenThread] = useState<string | null>(null)

  // ¿El asesor tiene Gmail conectado? (degradación suave: si no, no mostramos "Enviar email")
  useEffect(() => {
    let alive = true
    fetch("/api/google/oauth/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        const s = json?.data
        if (alive && s?.connected && s?.isValid !== false) setGmailConnected(true)
      })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  const scopeQuery = dealId ? `dealId=${dealId}` : `contactId=${contactId}`

  const refetch = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/activities?${scopeQuery}&pageSize=100`)
      if (res.ok) {
        const json = await res.json()
        setActivities(json.data ?? [])
      }
    } finally {
      setLoading(false)
    }
  }, [scopeQuery])

  useEffect(() => { refetch() }, [refetch])

  function afterMutation() {
    refetch()
    onChanged?.()
  }

  async function addNote() {
    const text = note.trim()
    if (!text) return
    setSavingNote(true)
    const body: Record<string, unknown> = {
      contactId,
      activityType: "NOTE",
      subject: text.length > 60 ? text.slice(0, 57) + "…" : text,
      description: text,
      status: "COMPLETADA",
    }
    if (dealId) body.dealId = dealId
    const res = await fetch("/api/activities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    setSavingNote(false)
    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      setActionError((json as { error?: string }).error ?? "No se pudo agregar la nota")
    } else {
      setActionError(null)
      setNote("")
      afterMutation()
    }
  }

  async function completeTask(id: string) {
    setBusyId(id)
    const res = await fetch(`/api/activities/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "COMPLETADA" }),
    })
    setBusyId(null)
    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      setActionError((json as { error?: string }).error ?? "No se pudo completar la actividad")
    } else {
      setActionError(null)
      afterMutation()
    }
  }

  async function remove(id: string) {
    if (!window.confirm("¿Eliminar esta actividad? No se puede deshacer.")) return
    setBusyId(id)
    const res = await fetch(`/api/activities/${id}`, { method: "DELETE" })
    setBusyId(null)
    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      setActionError((json as { error?: string }).error ?? "No se pudo eliminar la actividad")
    } else {
      setActionError(null)
      afterMutation()
    }
  }

  function openCreate() { setEditing(null); setShowForm(true) }
  function openEdit(a: Activity) {
    setEditing({
      id: a.id, activityType: a.activityType, subject: a.subject,
      description: a.description, dueDate: a.dueDate ?? null,
      duration_minutes: a.duration_minutes ?? null, outcome: a.outcome ?? null, status: a.status,
    })
    setShowForm(true)
  }

  return (
    <div>
      {/* Encabezado de acción */}
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--text-tertiary)]">
          Seguimiento
        </span>
        <div className="flex items-center gap-2">
          {gmailConnected && contactEmail && (
            <button className="btn-secondary text-[13px]" onClick={() => setShowComposer(true)}>
              <Mail className="h-3.5 w-3.5" /> Enviar email
            </button>
          )}
          {contactPhone && currentUserId && (
            <CallButton
              phone={contactPhone}
              contactId={contactId}
              userId={currentUserId}
              doNotContact={doNotContact}
            />
          )}
          <button className="btn-secondary text-[13px]" onClick={openCreate}>
            <Plus className="h-3.5 w-3.5" /> Registrar actividad
          </button>
        </div>
      </div>

      {/* Drawer de envío de email */}
      {showComposer && contactEmail && (
        <EmailComposerDrawer
          contactId={contactId}
          contactName={contactName}
          contactEmail={contactEmail}
          contactFirstName={contactFirstName}
          contactLastName={contactLastName}
          dealId={dealId}
          onClose={() => setShowComposer(false)}
          onSent={afterMutation}
        />
      )}

      {/* Error de acción */}
      {actionError && (
        <p className="mb-2 text-[12px]" style={{ color: "var(--color-error, #DC2626)" }}>{actionError}</p>
      )}

      {/* Compositor de nota rápida */}
      <div className="mb-4">
        <textarea
          className="form-input min-h-[64px] resize-y text-[13px]"
          placeholder="Escribe una nota rápida…"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") addNote() }}
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[11px] text-[color:var(--text-tertiary)]">⌘/Ctrl + Enter para guardar</span>
          <button className="btn-primary text-[13px]" onClick={addNote} disabled={savingNote || !note.trim()}>
            <Send className="h-3.5 w-3.5" /> {savingNote ? "Guardando…" : "Agregar nota"}
          </button>
        </div>
      </div>

      {/* Form modal de actividad tipada */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowForm(false)}>
          <div
            className="w-full max-w-md rounded-lg border p-5"
            style={{ background: "var(--bg-card)", borderColor: "var(--border-default)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-3 text-[15px] font-medium text-[color:var(--text-primary)]">
              {editing ? "Editar actividad" : "Registrar actividad"}
            </h3>
            <ActivityLogForm
              contactId={contactId}
              contactName={contactName}
              dealId={dealId}
              initial={editing ?? undefined}
              onSaved={() => { setShowForm(false); afterMutation() }}
              onCancel={() => setShowForm(false)}
            />
          </div>
        </div>
      )}

      {/* Timeline */}
      {loading ? (
        <p className="py-8 text-center text-[13px] text-[color:var(--text-tertiary)]">Cargando…</p>
      ) : activities.length === 0 ? (
        <p className="py-8 text-center text-[13px] text-[color:var(--text-tertiary)]">
          Sin actividades aún. Agrega una nota o registra una llamada/visita para empezar el seguimiento.
        </p>
      ) : (
        <ol className="relative space-y-4 border-l pl-5" style={{ borderColor: "var(--border-subtle)" }}>
          {activities.map((a) => {
            const Icon = TYPE_ICON[a.activityType] ?? StickyNote
            const isPendingTask = (a.activityType === "TASK" || a.activityType === "CALL_TASK") && a.status === "PENDIENTE"
            const busy = busyId === a.id
            return (
              <li key={a.id} className="group relative">
                <span
                  className="absolute -left-[27px] flex h-5 w-5 items-center justify-center rounded-full"
                  style={{ background: "var(--bg-card)", border: "1px solid var(--border-default)" }}
                >
                  <Icon className="h-3 w-3" style={{ color: "var(--text-tertiary)" }} />
                </span>
                <div className="rounded-md border p-3" style={{ borderColor: "var(--border-subtle)" }}>
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[13px] font-medium text-[color:var(--text-primary)]">{a.subject}</span>
                    <span className="shrink-0 text-[11px] text-[color:var(--text-tertiary)]">
                      {ACTIVITY_TYPE_LABELS[a.activityType] ?? a.activityType}
                      {a.duration_minutes ? ` · ${a.duration_minutes} min` : ""}
                    </span>
                  </div>
                  {a.description && a.description !== a.subject && (
                    <p className="mt-1 whitespace-pre-wrap text-[13px] text-[color:var(--text-secondary)]">{a.description}</p>
                  )}
                  {a.outcome && (
                    <p className="mt-1 text-[12px] text-[color:var(--text-secondary)]">Resultado: {a.outcome}</p>
                  )}
                  {a.recordingUrl && (
                    <a
                      href={a.recordingUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 block text-[11px] underline"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      Escuchar grabación
                    </a>
                  )}
                  <div className="mt-1.5 flex items-center gap-3 text-[11px] text-[color:var(--text-tertiary)]">
                    <span>{a.user?.name ?? "Sistema"}</span>
                    <span>{fmt(a.createdAt)}</span>
                    {a.status === "PENDIENTE" && a.dueDate && (
                      <span style={{ color: "var(--color-error, #DC2626)" }}>Vence {format(new Date(a.dueDate), "dd/MM/yy")}</span>
                    )}
                    {a.status === "COMPLETADA" && <span>· Completada</span>}
                    {a.status === "CANCELADA" && <span>· Cancelada</span>}
                  </div>

                  {/* Acciones (aparecen en hover) */}
                  <div className="mt-2 flex items-center gap-3 opacity-0 transition-opacity group-hover:opacity-100">
                    {isPendingTask && (
                      <button className="flex items-center gap-1 text-[11px] text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)]" onClick={() => completeTask(a.id)} disabled={busy}>
                        <Check className="h-3 w-3" /> Completar
                      </button>
                    )}
                    {a.activityType === "CALL_TASK" && a.status === "PENDIENTE" && contactPhone && currentUserId && (
                      <CallButton phone={contactPhone} contactId={contactId} userId={currentUserId} doNotContact={doNotContact} />
                    )}
                    <button className="flex items-center gap-1 text-[11px] text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)]" onClick={() => openEdit(a)} disabled={busy}>
                      <Pencil className="h-3 w-3" /> Editar
                    </button>
                    <button className="flex items-center gap-1 text-[11px] text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)]" onClick={() => remove(a.id)} disabled={busy}>
                      <Trash2 className="h-3 w-3" /> Borrar
                    </button>
                  </div>

                  {/* Expand de hilo Gmail (solo correos con threadId) */}
                  {a.gmailThreadId && (a.activityType === "EMAIL_SENT" || a.activityType === "EMAIL_RECEIVED") && (
                    <div className="mt-2">
                      <button
                        className="flex items-center gap-1 text-[11px] text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)]"
                        onClick={() => setOpenThread(openThread === a.gmailThreadId ? null : a.gmailThreadId!)}
                      >
                        {openThread === a.gmailThreadId ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                        {openThread === a.gmailThreadId ? "Ocultar hilo" : "Ver hilo completo"}
                      </button>
                      {openThread === a.gmailThreadId && <EmailThread threadId={a.gmailThreadId} />}
                    </div>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
