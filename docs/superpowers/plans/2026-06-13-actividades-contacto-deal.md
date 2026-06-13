# Sistema de Actividades en Contacto y Deal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir registrar, completar, editar y borrar actividades (llamada, whatsapp, reunión, visita, correo, nota, tarea) desde el detalle de contacto y de deal, con una estética minimalista B/N unificada.

**Architecture:** El modelo `Activity` y los server actions de crear/listar/actualizar ya existen. Se agrega `deleteActivity` + una ruta REST `/api/activities/[id]` (PATCH/DELETE), y un componente cliente nuevo y compartido `ActivityLog` (B/N) que se monta en ambos detalles. Los componentes coloridos viejos (`ActivityForm`/`ActivityTimeline`) NO se tocan (siguen en dashboard/reportes).

**Tech Stack:** Next.js 14 (App Router, `params` síncrono), Prisma, NextAuth, vitest (lógica pura), Tailwind + tokens B/N globales (`form-input`, `btn-primary`, `btn-secondary`, vars `--text-*`/`--border-*`/`--bg-*`).

**Branch:** `feat/actividades-contacto-deal` (ya creada).

---

### Task 1: Predicado RBAC puro `canModifyActivity` (TDD)

**Files:**
- Create: `src/lib/activities/permissions.ts`
- Test: `src/lib/activities/permissions.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/activities/permissions.test.ts
import { describe, it, expect } from "vitest"
import { canModifyActivity } from "./permissions"

describe("canModifyActivity", () => {
  it("ASESOR dueño puede modificar", () => {
    expect(canModifyActivity("ASESOR", true)).toBe(true)
  })
  it("ASESOR ajeno NO puede modificar", () => {
    expect(canModifyActivity("ASESOR", false)).toBe(false)
  })
  it("ASESOR_JR ajeno NO puede modificar", () => {
    expect(canModifyActivity("ASESOR_JR", false)).toBe(false)
  })
  it("ADMIN puede modificar aunque no sea dueño", () => {
    expect(canModifyActivity("ADMIN", false)).toBe(true)
  })
  it("GERENTE puede modificar aunque no sea dueño", () => {
    expect(canModifyActivity("GERENTE", false)).toBe(true)
  })
  it("TEAM_LEADER puede modificar aunque no sea dueño", () => {
    expect(canModifyActivity("TEAM_LEADER", false)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- permissions`
Expected: FAIL — `Failed to resolve import "./permissions"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/activities/permissions.ts
// Roles que solo pueden tocar sus propias actividades.
const OWN_ACCESS_ROLES = ["ASESOR", "ASESOR_SR", "ASESOR_JR", "BROKER", "HOSTESS"]

/**
 * ¿Puede `userRole` modificar o borrar una actividad?
 * `isOwner` = la actividad pertenece al usuario actual.
 * Roles "own" solo tocan lo propio; el resto (equipo/full) sí — la
 * visibilidad por equipo ya la restringe getActivities() al listar.
 */
export function canModifyActivity(userRole: string, isOwner: boolean): boolean {
  if (OWN_ACCESS_ROLES.includes(userRole)) return isOwner
  return true
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- permissions`
Expected: PASS (6 passed).

- [ ] **Step 5: Commit**

```bash
git add src/lib/activities/permissions.ts src/lib/activities/permissions.test.ts
git commit -m "feat(activities): predicado RBAC puro canModifyActivity + test"
```

---

### Task 2: `deleteActivity` + refactor `updateActivity` para usar el predicado

**Files:**
- Modify: `src/server/activities.ts` (importar predicado; refactor `updateActivity:260-262`; agregar `deleteActivity` al final del archivo)

- [ ] **Step 1: Añadir import del predicado**

En la cabecera de imports de `src/server/activities.ts` (debajo de la línea `import { dispatchWebhook } ...`), agregar:

```ts
import { canModifyActivity } from "@/lib/activities/permissions"
```

- [ ] **Step 2: Refactorizar el guard de `updateActivity`**

Reemplazar el bloque actual (`src/server/activities.ts:257-262`):

```ts
  // RBAC: solo el dueño, su líder o roles superiores pueden editar
  const userRole = session.user.role
  const currentUserId = session.user.id
  if (OWN_ACCESS_ROLES.includes(userRole) && existing.userId !== currentUserId) {
    throw new Error("No tienes permiso para editar esta actividad")
  }
```

por:

```ts
  // RBAC vía predicado compartido (DRY con deleteActivity)
  if (!canModifyActivity(session.user.role, existing.userId === session.user.id)) {
    throw new Error("No tienes permiso para editar esta actividad")
  }
```

- [ ] **Step 3: Agregar `deleteActivity` al final de `src/server/activities.ts`**

```ts
// ============================================================
// deleteActivity — soft-delete (deletedAt) con RBAC
// ============================================================

export async function deleteActivity(id: string) {
  const session = await getServerSession()
  if (!session?.user) throw new Error("No autorizado")

  const existing = await prisma.activity.findUnique({
    where: { id, deletedAt: null },
  })
  if (!existing) throw new Error("Actividad no encontrada")

  if (!canModifyActivity(session.user.role, existing.userId === session.user.id)) {
    throw new Error("No tienes permiso para eliminar esta actividad")
  }

  await prisma.activity.update({
    where: { id },
    data: { deletedAt: new Date() },
  })

  return { ok: true }
}
```

- [ ] **Step 4: Verificar tipos/lint**

Run: `npm run lint`
Expected: sin errores nuevos en `src/server/activities.ts`. (Si `OWN_ACCESS_ROLES` queda sin uso en el archivo, dejarlo: lo usa `getActivities`/`getOverdueTasks`.)

- [ ] **Step 5: Commit**

```bash
git add src/server/activities.ts
git commit -m "feat(activities): deleteActivity soft-delete + updateActivity usa canModifyActivity"
```

---

### Task 3: Ruta REST `/api/activities/[id]` (PATCH + DELETE)

**Files:**
- Create: `src/app/api/activities/[id]/route.ts`

> Nota: `params` es **síncrono** en este repo (ver `src/app/api/deals/[id]/route.ts:120`). NO usar `Promise<params>`.

- [ ] **Step 1: Crear la ruta**

```ts
// ============================================================
// API Route: /api/activities/[id]
// PATCH  - Actualizar (completar tarea, editar, cancelar)
// DELETE - Soft-delete
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { updateActivity, deleteActivity } from "@/server/activities";

const updateActivitySchema = z.object({
  subject: z.string().min(3).max(200).trim().optional(),
  description: z.string().max(5000).nullable().optional(),
  dueDate: z.coerce.date().nullable().optional(),
  status: z.enum(["PENDIENTE", "COMPLETADA", "VENCIDA", "CANCELADA"]).optional(),
  outcome: z.string().max(1000).nullable().optional(),
  duration_minutes: z.number().int().min(0).max(480).nullable().optional(),
});

function errToResponse(error: unknown) {
  const msg = error instanceof Error ? error.message : "";
  if (msg.includes("No autorizado")) return NextResponse.json({ error: msg }, { status: 401 });
  if (msg.includes("permiso")) return NextResponse.json({ error: msg }, { status: 403 });
  if (msg.includes("no encontrada")) return NextResponse.json({ error: msg }, { status: 404 });
  console.error("Error en /api/activities/[id]:", error);
  return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const validation = updateActivitySchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: "Datos inválidos", details: validation.error.flatten() },
        { status: 400 }
      );
    }
    const activity = await updateActivity(params.id, validation.data);
    return NextResponse.json({ data: activity });
  } catch (error) {
    return errToResponse(error);
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const result = await deleteActivity(params.id);
    return NextResponse.json({ data: result });
  } catch (error) {
    return errToResponse(error);
  }
}
```

- [ ] **Step 2: Verificar build**

Run: `npm run build`
Expected: compila; la ruta `/api/activities/[id]` aparece en el output de rutas.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/activities/[id]/route.ts"
git commit -m "feat(activities): ruta PATCH/DELETE /api/activities/[id]"
```

---

### Task 4: Componente `ActivityLogForm` (B/N, crear/editar)

**Files:**
- Create: `src/components/activities/activity-log-form.tsx`

- [ ] **Step 1: Crear el componente**

```tsx
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
```

- [ ] **Step 2: Verificar build**

Run: `npm run build`
Expected: compila sin errores de tipos. (`form-input`, `btn-primary`, `btn-secondary` son clases globales existentes — verificar en `globals.css` si lint marca clases desconocidas; no debería, son CSS plano.)

- [ ] **Step 3: Commit**

```bash
git add src/components/activities/activity-log-form.tsx
git commit -m "feat(activities): ActivityLogForm B/N para crear/editar"
```

---

### Task 5: Componente `ActivityLog` (B/N, compositor + timeline interactivo)

**Files:**
- Create: `src/components/activities/activity-log.tsx`

- [ ] **Step 1: Crear el componente**

```tsx
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
  type LucideIcon,
} from "lucide-react"
import { ACTIVITY_TYPE_LABELS } from "@/lib/constants"
import { ActivityLogForm, type ActivityForEdit } from "./activity-log-form"

const TYPE_ICON: Record<string, LucideIcon> = {
  CALL_OUTBOUND: Phone, CALL_INBOUND: Phone,
  WHATSAPP_OUT: MessageSquare, WHATSAPP_IN: MessageSquare,
  SMS_OUT: MessageSquare, SMS_IN: MessageSquare,
  EMAIL_SENT: Mail, EMAIL_RECEIVED: Mail,
  MEETING_VIRTUAL: Users, MEETING_PRESENTIAL: Users, MEETING_SHOWROOM: Users,
  DISCOVERY_CALL: ClipboardCheck, PROPOSAL_DELIVERY: FileText,
  FOLLOW_UP: Bell, WALK_IN: MapPin, NOTE: StickyNote, TASK: CheckSquare,
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
  user?: { name: string } | null
}

interface ActivityLogProps {
  contactId: string
  contactName: string
  dealId?: string
  onChanged?: () => void
}

function fmt(d: string): string {
  return format(new Date(d), "d MMM yyyy, HH:mm", { locale: es })
}

export function ActivityLog({ contactId, contactName, dealId, onChanged }: ActivityLogProps) {
  const [activities, setActivities] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)
  const [note, setNote] = useState("")
  const [savingNote, setSavingNote] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<ActivityForEdit | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

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
    if (res.ok) { setNote(""); afterMutation() }
  }

  async function completeTask(id: string) {
    setBusyId(id)
    await fetch(`/api/activities/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "COMPLETADA" }),
    })
    setBusyId(null)
    afterMutation()
  }

  async function remove(id: string) {
    if (!window.confirm("¿Eliminar esta actividad? No se puede deshacer.")) return
    setBusyId(id)
    await fetch(`/api/activities/${id}`, { method: "DELETE" })
    setBusyId(null)
    afterMutation()
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
        <button className="btn-secondary text-[13px]" onClick={openCreate}>
          <Plus className="h-3.5 w-3.5" /> Registrar actividad
        </button>
      </div>

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
            const isPendingTask = a.activityType === "TASK" && a.status === "PENDIENTE"
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
                    <button className="flex items-center gap-1 text-[11px] text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)]" onClick={() => openEdit(a)} disabled={busy}>
                      <Pencil className="h-3 w-3" /> Editar
                    </button>
                    <button className="flex items-center gap-1 text-[11px] text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)]" onClick={() => remove(a.id)} disabled={busy}>
                      <Trash2 className="h-3 w-3" /> Borrar
                    </button>
                  </div>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verificar build**

Run: `npm run build`
Expected: compila sin errores de tipos.

- [ ] **Step 3: Commit**

```bash
git add src/components/activities/activity-log.tsx
git commit -m "feat(activities): ActivityLog B/N compartido (compositor + timeline interactivo)"
```

---

### Task 6: Montar `ActivityLog` en el detalle de contacto

**Files:**
- Modify: `src/components/contacts/contact-detail.tsx`

> Leer el archivo completo antes de editar. La sección a reemplazar es el `Section "Seguimiento"` (`:480-549`): compositor `addNote` + `<ol>` timeline bespoke.

- [ ] **Step 1: Agregar el import**

Cerca de los otros imports de componentes en `contact-detail.tsx`, agregar:

```tsx
import { ActivityLog } from "@/components/activities/activity-log";
```

- [ ] **Step 2: Reemplazar el cuerpo del `Section "Seguimiento"`**

Reemplazar TODO el contenido entre `<Section title="Seguimiento">` y su `</Section>` (`:480-549`, el compositor de notas + el bloque `{activities.length > 0 ? (<ol>…</ol>) : (<p>…</p>)}`) por:

```tsx
          <ActivityLog
            contactId={contact.id}
            contactName={`${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim()}
            onChanged={() => router.refresh()}
          />
```

> El `ActivityLog` ya renderiza su propio encabezado "Seguimiento". Si `<Section title="Seguimiento">` duplica el título, quitar el `title` del `Section` (dejar `<Section>`), o eliminar el wrapper `Section` y dejar solo `<ActivityLog>` dentro de `<div className="lg:col-span-7">`. Elegir lo que respete el ritmo visual de la página.

- [ ] **Step 3: Eliminar código muerto**

- Borrar la función `addNote` (`:287-307`).
- Borrar los estados `note` y `savingNote` (buscar `useState` de `note`/`savingNote`) si ya no se usan en el archivo.
- Si el import `Send` de lucide queda sin uso, quitarlo. (Verificar: `grep -n "Send" contact-detail.tsx`.)
- NO borrar `const activities = contact.activities ?? []` ni `nextFollowUp` — siguen alimentando las métricas del encabezado.

- [ ] **Step 4: Verificar build + lint**

Run: `npm run build && npm run lint`
Expected: compila; sin variables/imports sin usar en `contact-detail.tsx`.

- [ ] **Step 5: Commit**

```bash
git add src/components/contacts/contact-detail.tsx
git commit -m "feat(contacts): detalle usa ActivityLog (registrar/completar/editar/borrar)"
```

---

### Task 7: Montar `ActivityLog` en el detalle de deal

**Files:**
- Modify: `src/app/(dashboard)/pipeline/[id]/deal-detail-client.tsx`

> Leer el archivo completo antes de editar. La sección a reemplazar es la `Card "Historial de Actividades"` (`:413-459`).

- [ ] **Step 1: Agregar el import**

```tsx
import { ActivityLog } from "@/components/activities/activity-log";
```

- [ ] **Step 2: Reemplazar la Card de historial**

Reemplazar TODO el bloque `{/* Timeline de actividades */} <Card>…</Card>` (`:413-459`) por:

```tsx
      {/* Actividades */}
      <Card>
        <CardContent className="pt-6">
          <ActivityLog
            contactId={deal.contactId}
            contactName={`${deal.contact?.firstName ?? ""} ${deal.contact?.lastName ?? ""}`.trim()}
            dealId={deal.id}
            onChanged={() => router.refresh()}
          />
        </CardContent>
      </Card>
```

> Verificar que `router` está disponible en el componente (import `useRouter` de `next/navigation`). Si no, agregarlo: `const router = useRouter()`. Si el componente recibe los datos por props sin router, usar el patrón de refetch ya presente o `window.location.reload()` como último recurso — preferir `router.refresh()`.

- [ ] **Step 3: Eliminar código muerto**

- Si `timeAgo` y/o `ACTIVITY_TYPE_LABELS` ya no se usan en el archivo tras quitar la card, removerlos. (Verificar con grep antes de borrar — `Badge`/`ACTIVITY_TYPE_LABELS` pueden usarse en otras partes del archivo.)

- [ ] **Step 4: Verificar build + lint**

Run: `npm run build && npm run lint`
Expected: compila; sin imports sin usar.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(dashboard)/pipeline/[id]/deal-detail-client.tsx"
git commit -m "feat(deals): detalle usa ActivityLog (registrar/completar/editar/borrar)"
```

---

### Task 8: Verificación end-to-end (build + tests + smoke)

**Files:** ninguno (verificación).

- [ ] **Step 1: Suite de tests**

Run: `npm test`
Expected: PASS, incluyendo `permissions.test.ts` (6 tests). Sin regresiones.

- [ ] **Step 2: Build de producción**

Run: `npm run build`
Expected: build verde; rutas `/api/activities` y `/api/activities/[id]` presentes.

- [ ] **Step 3: Smoke manual (Playwright MCP, app en `npm run dev`)**

Con un usuario ADMIN (ver memoria de credenciales del CRM). Verificar y reportar PASS/FAIL de cada uno:
1. Contacto → "Registrar actividad" → tipo Llamada saliente + duración 15 → aparece en timeline.
2. Contacto → nota rápida (⌘/Ctrl+Enter) → aparece como NOTE.
3. Contacto → registrar TASK con fecha de vencimiento → aparece como PENDIENTE con "Vence …".
4. Hover sobre la TASK → "Completar" → pasa a Completada.
5. Hover → "Editar" → cambiar asunto → guarda y refleja.
6. Hover → "Borrar" → confirmar → desaparece.
7. Deal → "Registrar actividad" → contacto del deal ya en contexto (sin buscador) → reunión → aparece.
8. Verificar que el dashboard `recent-activities` y `reports` siguen renderizando igual (componentes coloridos intactos).

- [ ] **Step 4: Reportar resultados**

Documentar los 8 resultados del smoke. Si todo PASS, el Entregable A está listo para merge (no mergear sin autorización de Luis).
