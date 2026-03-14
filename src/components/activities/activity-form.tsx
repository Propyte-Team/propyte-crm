// ============================================================
// Formulario para registrar actividades
// Componente cliente con grupos de tipos, selección de contacto/deal
// ============================================================
"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ACTIVITY_TYPE_LABELS } from "@/lib/constants"

// Grupos de tipos de actividad para el select
const ACTIVITY_TYPE_GROUPS = [
  {
    label: "Contacto",
    types: ["CALL_OUTBOUND", "CALL_INBOUND", "WHATSAPP_OUT", "WHATSAPP_IN", "EMAIL_SENT", "EMAIL_RECEIVED"],
  },
  {
    label: "Reunión",
    types: ["MEETING_VIRTUAL", "MEETING_PRESENTIAL", "MEETING_SHOWROOM", "DISCOVERY_CALL"],
  },
  {
    label: "Seguimiento",
    types: ["PROPOSAL_DELIVERY", "FOLLOW_UP", "WALK_IN", "CONTRACT_REVIEW", "CLOSING_ACTIVITY"],
  },
  {
    label: "Interno",
    types: ["NOTE", "TASK"],
  },
]

// Tipos que requieren duración (llamadas y reuniones)
const DURATION_TYPES = [
  "CALL_OUTBOUND", "CALL_INBOUND", "MEETING_VIRTUAL",
  "MEETING_PRESENTIAL", "MEETING_SHOWROOM", "DISCOVERY_CALL",
]

// Interfaz de contacto resumido
interface ContactOption {
  id: string
  firstName: string
  lastName: string
}

// Interfaz de deal resumido
interface DealOption {
  id: string
  stage: string
  estimatedValue: number
}

interface ActivityFormProps {
  onSuccess?: () => void
  preselectedContactId?: string
  preselectedDealId?: string
}

export function ActivityForm({ onSuccess, preselectedContactId, preselectedDealId }: ActivityFormProps) {
  // Estado del formulario
  const [activityType, setActivityType] = useState("")
  const [subject, setSubject] = useState("")
  const [description, setDescription] = useState("")
  const [contactId, setContactId] = useState(preselectedContactId ?? "")
  const [dealId, setDealId] = useState(preselectedDealId ?? "")
  const [dueDate, setDueDate] = useState("")
  const [durationMinutes, setDurationMinutes] = useState("")
  const [outcome, setOutcome] = useState("")
  const [status, setStatus] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  // Opciones de contacto y deal
  const [contacts, setContacts] = useState<ContactOption[]>([])
  const [deals, setDeals] = useState<DealOption[]>([])
  const [contactSearch, setContactSearch] = useState("")
  const [loadingContacts, setLoadingContacts] = useState(false)

  // Buscar contactos cuando cambia el texto de búsqueda
  useEffect(() => {
    const timeout = setTimeout(async () => {
      if (contactSearch.length < 2 && !preselectedContactId) return
      setLoadingContacts(true)
      try {
        const params = new URLSearchParams()
        if (contactSearch) params.set("query", contactSearch)
        params.set("pageSize", "20")
        const res = await fetch(`/api/contacts?${params}`)
        if (res.ok) {
          const json = await res.json()
          setContacts(json.data ?? [])
        }
      } catch {
        // Error silencioso en búsqueda
      } finally {
        setLoadingContacts(false)
      }
    }, 300)
    return () => clearTimeout(timeout)
  }, [contactSearch, preselectedContactId])

  // Cargar contacto preseleccionado
  useEffect(() => {
    if (preselectedContactId) {
      fetch(`/api/contacts?pageSize=1&query=${preselectedContactId}`)
        .then((r) => r.json())
        .then((json) => {
          if (json.data?.length) setContacts(json.data)
        })
        .catch(() => {})
    }
  }, [preselectedContactId])

  // Cargar deals del contacto seleccionado
  useEffect(() => {
    if (!contactId) {
      setDeals([])
      return
    }
    fetch(`/api/deals?contactId=${contactId}&pageSize=50`)
      .then((r) => r.json())
      .then((json) => setDeals(json.data ?? []))
      .catch(() => setDeals([]))
  }, [contactId])

  // Mostrar campo de fecha de vencimiento solo para TASK
  const showDueDate = activityType === "TASK"
  // Mostrar campo de duración para llamadas y reuniones
  const showDuration = DURATION_TYPES.includes(activityType)

  // Enviar formulario
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setSubmitting(true)

    try {
      const body: Record<string, unknown> = {
        activityType,
        subject,
        contactId,
      }
      if (description) body.description = description
      if (dealId) body.dealId = dealId
      if (dueDate) body.dueDate = new Date(dueDate).toISOString()
      if (durationMinutes) body.duration_minutes = parseInt(durationMinutes)
      if (outcome) body.outcome = outcome
      if (status) body.status = status

      const res = await fetch("/api/activities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const json = await res.json()
        throw new Error(json.error ?? "Error al crear actividad")
      }

      // Limpiar formulario
      setActivityType("")
      setSubject("")
      setDescription("")
      setDealId("")
      setDueDate("")
      setDurationMinutes("")
      setOutcome("")
      setStatus("")

      onSuccess?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Registrar Actividad</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Tipo de actividad (agrupado) */}
          <div className="space-y-2">
            <Label htmlFor="activityType">Tipo de actividad *</Label>
            <Select value={activityType} onValueChange={setActivityType} required>
              <SelectTrigger id="activityType">
                <SelectValue placeholder="Seleccionar tipo..." />
              </SelectTrigger>
              <SelectContent>
                {ACTIVITY_TYPE_GROUPS.map((group) => (
                  <SelectGroup key={group.label}>
                    <SelectLabel>{group.label}</SelectLabel>
                    {group.types.map((type) => (
                      <SelectItem key={type} value={type}>
                        {ACTIVITY_TYPE_LABELS[type] ?? type}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Asunto */}
          <div className="space-y-2">
            <Label htmlFor="subject">Asunto *</Label>
            <Input
              id="subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Descripción breve de la actividad"
              required
              minLength={3}
              maxLength={200}
            />
          </div>

          {/* Descripción */}
          <div className="space-y-2">
            <Label htmlFor="description">Descripción</Label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Detalles adicionales..."
              className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              maxLength={5000}
            />
          </div>

          {/* Contacto (búsqueda) */}
          <div className="space-y-2">
            <Label htmlFor="contactSearch">Contacto *</Label>
            <Input
              id="contactSearch"
              value={contactSearch}
              onChange={(e) => setContactSearch(e.target.value)}
              placeholder="Buscar contacto por nombre..."
              className="mb-2"
            />
            <Select value={contactId} onValueChange={setContactId} required>
              <SelectTrigger>
                <SelectValue placeholder={loadingContacts ? "Buscando..." : "Seleccionar contacto..."} />
              </SelectTrigger>
              <SelectContent>
                {contacts.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.firstName} {c.lastName}
                  </SelectItem>
                ))}
                {contacts.length === 0 && (
                  <SelectItem value="__none" disabled>
                    {contactSearch.length < 2 ? "Escribe para buscar..." : "Sin resultados"}
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>

          {/* Deal (opcional, filtrado por contacto) */}
          <div className="space-y-2">
            <Label htmlFor="dealId">Deal (opcional)</Label>
            <Select value={dealId} onValueChange={setDealId}>
              <SelectTrigger>
                <SelectValue placeholder="Sin deal asociado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Ninguno</SelectItem>
                {deals.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.stage} — ${Number(d.estimatedValue).toLocaleString("es-MX")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Fecha de vencimiento (solo TASK) */}
          {showDueDate && (
            <div className="space-y-2">
              <Label htmlFor="dueDate">Fecha de vencimiento</Label>
              <Input
                id="dueDate"
                type="datetime-local"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          )}

          {/* Duración en minutos (para llamadas y reuniones) */}
          {showDuration && (
            <div className="space-y-2">
              <Label htmlFor="duration">Duración (minutos)</Label>
              <Input
                id="duration"
                type="number"
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(e.target.value)}
                placeholder="30"
                min={0}
                max={480}
              />
            </div>
          )}

          {/* Resultado (para actividades completadas) */}
          <div className="space-y-2">
            <Label htmlFor="outcome">Resultado</Label>
            <Input
              id="outcome"
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
              placeholder="Resultado de la actividad..."
              maxLength={1000}
            />
          </div>

          {/* Estado */}
          <div className="space-y-2">
            <Label htmlFor="status">Estado</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger>
                <SelectValue placeholder="Automático según tipo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Automático</SelectItem>
                <SelectItem value="PENDIENTE">Pendiente</SelectItem>
                <SelectItem value="COMPLETADA">Completada</SelectItem>
                <SelectItem value="CANCELADA">Cancelada</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Mensaje de error */}
          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}

          {/* Botón de envío */}
          <Button type="submit" className="w-full" disabled={submitting || !activityType || !subject || !contactId}>
            {submitting ? "Registrando..." : "Registrar Actividad"}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
