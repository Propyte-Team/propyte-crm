// ============================================================
// Formulario B/N para crear/editar una actividad tipada.
// Usado SOLO en los detalles de contacto/deal (no toca el ActivityForm colorido).
// Contacto/deal vienen del contexto (no hay buscador).
// ============================================================
"use client"

import { useState } from "react"
import { ACTIVITY_TYPE_LABELS } from "@/lib/constants"

const ACTIVITY_TYPE_GROUPS = [
  { label: "Contacto", types: ["CALL_OUTBOUND", "CALL_INBOUND", "WHATSAPP_OUT", "WHATSAPP_IN", "EMAIL_SENT", "EMAIL_RECEIVED"] },
  { label: "Reunión", types: ["MEETING_VIRTUAL", "MEETING_PRESENTIAL", "MEETING_SHOWROOM", "DISCOVERY_CALL"] },
  { label: "Seguimiento", types: ["PROPOSAL_DELIVERY", "FOLLOW_UP", "WALK_IN", "CONTRACT_REVIEW", "CLOSING_ACTIVITY"] },
  { label: "Interno", types: ["NOTE", "TASK"] },
]
const DURATION_TYPES = ["CALL_OUTBOUND", "CALL_INBOUND", "MEETING_VIRTUAL", "MEETING_PRESENTIAL", "MEETING_SHOWROOM", "DISCOVERY_CALL"]

export interface ActivityForEdit {
  id: string
  activityType: string
  subject: string
  description?: string | null
  dueDate?: string | null
  duration_minutes?: number | null
  outcome?: string | null
  status: string
}

interface Props {
  contactId: string
  contactName: string
  dealId?: string
  initial?: ActivityForEdit
  onSaved: () => void
  onCancel: () => void
}

// ISO → valor para <input type="datetime-local"> en hora local
function toLocalInput(iso: string): string {
  const d = new Date(iso)
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 16)
}

export function ActivityLogForm({ contactId, contactName, dealId, initial, onSaved, onCancel }: Props) {
  const editing = !!initial
  const [activityType, setActivityType] = useState(initial?.activityType ?? "")
  const [subject, setSubject] = useState(initial?.subject ?? "")
  const [description, setDescription] = useState(initial?.description ?? "")
  const [dueDate, setDueDate] = useState(initial?.dueDate ? toLocalInput(initial.dueDate) : "")
  const [duration, setDuration] = useState(initial?.duration_minutes ? String(initial.duration_minutes) : "")
  const [outcome, setOutcome] = useState(initial?.outcome ?? "")
  const [status, setStatus] = useState(initial?.status ?? "")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  const showDue = activityType === "TASK"
  const showDur = DURATION_TYPES.includes(activityType)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setSubmitting(true)
    try {
      let res: Response
      if (editing) {
        const body: Record<string, unknown> = {
          subject,
          description: description || null,
          outcome: outcome || null,
        }
        if (showDue) body.dueDate = dueDate ? new Date(dueDate).toISOString() : null
        if (showDur) body.duration_minutes = duration ? parseInt(duration) : null
        if (status) body.status = status
        res = await fetch(`/api/activities/${initial!.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
      } else {
        const body: Record<string, unknown> = { contactId, activityType, subject }
        if (dealId) body.dealId = dealId
        if (description) body.description = description
        if (showDue && dueDate) body.dueDate = new Date(dueDate).toISOString()
        if (showDur && duration) body.duration_minutes = parseInt(duration)
        if (outcome) body.outcome = outcome
        if (status) body.status = status
        res = await fetch("/api/activities", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
      }
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error ?? "Error al guardar la actividad")
      }
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {/* Contacto fijo (contexto) */}
      <div className="text-[12px] text-[color:var(--text-tertiary)]">
        Contacto: <span className="text-[color:var(--text-secondary)]">{contactName}</span>
        {dealId && " · asociada al deal actual"}
      </div>

      {/* Tipo (read-only al editar: updateActivity no cambia el tipo) */}
      <div className="space-y-1">
        <label className="text-[12px] text-[color:var(--text-secondary)]">Tipo *</label>
        <select
          className="form-input text-[13px]"
          value={activityType}
          onChange={(e) => setActivityType(e.target.value)}
          required
          disabled={editing}
        >
          <option value="" disabled>Seleccionar tipo…</option>
          {ACTIVITY_TYPE_GROUPS.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.types.map((t) => (
                <option key={t} value={t}>{ACTIVITY_TYPE_LABELS[t] ?? t}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      {/* Asunto */}
      <div className="space-y-1">
        <label className="text-[12px] text-[color:var(--text-secondary)]">Asunto *</label>
        <input
          className="form-input text-[13px]"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Descripción breve"
          required
          minLength={3}
          maxLength={200}
        />
      </div>

      {/* Descripción */}
      <div className="space-y-1">
        <label className="text-[12px] text-[color:var(--text-secondary)]">Descripción</label>
        <textarea
          className="form-input min-h-[64px] resize-y text-[13px]"
          value={description ?? ""}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Detalles adicionales…"
          maxLength={5000}
        />
      </div>

      {showDue && (
        <div className="space-y-1">
          <label className="text-[12px] text-[color:var(--text-secondary)]">Fecha de vencimiento</label>
          <input className="form-input text-[13px]" type="datetime-local" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </div>
      )}

      {showDur && (
        <div className="space-y-1">
          <label className="text-[12px] text-[color:var(--text-secondary)]">Duración (min)</label>
          <input className="form-input text-[13px]" type="number" min={0} max={480} value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="30" />
        </div>
      )}

      <div className="space-y-1">
        <label className="text-[12px] text-[color:var(--text-secondary)]">Resultado</label>
        <input className="form-input text-[13px]" value={outcome ?? ""} onChange={(e) => setOutcome(e.target.value)} placeholder="Resultado de la actividad…" maxLength={1000} />
      </div>

      <div className="space-y-1">
        <label className="text-[12px] text-[color:var(--text-secondary)]">Estado</label>
        <select className="form-input text-[13px]" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Automático según tipo</option>
          <option value="PENDIENTE">Pendiente</option>
          <option value="COMPLETADA">Completada</option>
          <option value="CANCELADA">Cancelada</option>
        </select>
      </div>

      {error && <p className="text-[12px]" style={{ color: "var(--color-error, #DC2626)" }}>{error}</p>}

      <div className="flex items-center justify-end gap-2 pt-1">
        <button type="button" className="btn-secondary text-[13px]" onClick={onCancel} disabled={submitting}>Cancelar</button>
        <button type="submit" className="btn-primary text-[13px]" disabled={submitting || !subject || (!editing && !activityType)}>
          {submitting ? "Guardando…" : editing ? "Guardar cambios" : "Registrar"}
        </button>
      </div>
    </form>
  )
}
