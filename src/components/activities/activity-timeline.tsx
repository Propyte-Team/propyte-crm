// ============================================================
// Timeline de actividades (reutilizable en detalle de contacto y deal)
// Vertical con separadores por fecha, iconos por tipo, expansión de descripción
// ============================================================
"use client"

import { useState } from "react"
import { format, isToday, isYesterday, isBefore, startOfDay } from "date-fns"
import { es } from "date-fns/locale"
import {
  Phone,
  MessageSquare,
  Mail,
  Users,
  ClipboardCheck,
  FileText,
  Bell,
  StickyNote,
  CheckSquare,
  MapPin,
  FileSignature,
  Trophy,
  type LucideIcon,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { ACTIVITY_TYPE_LABELS } from "@/lib/constants"

// Mapa de iconos por tipo de actividad
const TYPE_ICON_MAP: Record<string, { icon: LucideIcon; color: string; bg: string }> = {
  CALL_OUTBOUND: { icon: Phone, color: "text-blue-600", bg: "bg-blue-100" },
  CALL_INBOUND: { icon: Phone, color: "text-blue-400", bg: "bg-blue-50" },
  WHATSAPP_OUT: { icon: MessageSquare, color: "text-green-600", bg: "bg-green-100" },
  WHATSAPP_IN: { icon: MessageSquare, color: "text-green-400", bg: "bg-green-50" },
  EMAIL_SENT: { icon: Mail, color: "text-purple-600", bg: "bg-purple-100" },
  EMAIL_RECEIVED: { icon: Mail, color: "text-purple-400", bg: "bg-purple-50" },
  MEETING_VIRTUAL: { icon: Users, color: "text-indigo-600", bg: "bg-indigo-100" },
  MEETING_PRESENTIAL: { icon: Users, color: "text-indigo-700", bg: "bg-indigo-100" },
  MEETING_SHOWROOM: { icon: Users, color: "text-indigo-500", bg: "bg-indigo-50" },
  DISCOVERY_CALL: { icon: ClipboardCheck, color: "text-teal-600", bg: "bg-teal-100" },
  PROPOSAL_DELIVERY: { icon: FileText, color: "text-orange-600", bg: "bg-orange-100" },
  FOLLOW_UP: { icon: Bell, color: "text-amber-600", bg: "bg-amber-100" },
  WALK_IN: { icon: MapPin, color: "text-pink-600", bg: "bg-pink-100" },
  NOTE: { icon: StickyNote, color: "text-yellow-600", bg: "bg-yellow-100" },
  TASK: { icon: CheckSquare, color: "text-slate-600", bg: "bg-slate-100" },
  CONTRACT_REVIEW: { icon: FileSignature, color: "text-cyan-600", bg: "bg-cyan-100" },
  CLOSING_ACTIVITY: { icon: Trophy, color: "text-emerald-600", bg: "bg-emerald-100" },
}

// Interfaz de actividad para el timeline
export interface TimelineActivity {
  id: string
  activityType: string
  subject: string
  description?: string | null
  createdAt: string | Date
  dueDate?: string | Date | null
  completedAt?: string | Date | null
  status: string
  outcome?: string | null
  duration_minutes?: number | null
  user: { name: string }
  contact?: { firstName: string; lastName: string }
}

interface ActivityTimelineProps {
  activities: TimelineActivity[]
}

export function ActivityTimeline({ activities }: ActivityTimelineProps) {
  // Estado para expandir descripción de cada actividad
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  // Alternar expansión
  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (activities.length === 0) {
    return (
      <div className="py-8 text-center text-muted-foreground">
        No hay actividades registradas
      </div>
    )
  }

  // Agrupar actividades por fecha
  const groupedByDate: Record<string, TimelineActivity[]> = {}
  for (const activity of activities) {
    const date = new Date(activity.createdAt)
    const dateKey = format(date, "yyyy-MM-dd")
    if (!groupedByDate[dateKey]) groupedByDate[dateKey] = []
    groupedByDate[dateKey].push(activity)
  }

  // Formatear separador de fecha
  function formatDateSeparator(dateStr: string): string {
    const date = new Date(dateStr)
    if (isToday(date)) return "Hoy"
    if (isYesterday(date)) return "Ayer"
    return format(date, "EEEE d 'de' MMMM", { locale: es })
  }

  // Determinar color del badge de fecha de vencimiento
  function getDueDateBadge(dueDate: Date, status: string) {
    if (status === "COMPLETADA" || status === "CANCELADA") return null

    const now = new Date()
    const todayStart = startOfDay(now)
    const dueDateStart = startOfDay(dueDate)

    if (isBefore(dueDateStart, todayStart)) {
      // Vencida
      return (
        <Badge variant="destructive" className="text-xs">
          Vencida: {format(dueDate, "dd/MM/yy")}
        </Badge>
      )
    }
    if (dueDateStart.getTime() === todayStart.getTime()) {
      // Vence hoy
      return (
        <Badge className="bg-amber-100 text-amber-700 text-xs">
          Vence hoy
        </Badge>
      )
    }
    // Futuro
    return (
      <Badge className="bg-green-100 text-green-700 text-xs">
        Vence: {format(dueDate, "dd/MM/yy")}
      </Badge>
    )
  }

  return (
    <div className="space-y-6">
      {Object.entries(groupedByDate).map(([dateKey, dayActivities]) => (
        <div key={dateKey}>
          {/* Separador de fecha */}
          <div className="mb-3 flex items-center gap-2">
            <span className="text-xs font-semibold uppercase text-muted-foreground">
              {formatDateSeparator(dateKey)}
            </span>
            <div className="flex-1 border-t" />
          </div>

          {/* Línea vertical del timeline */}
          <div className="relative ml-4 border-l-2 border-muted pl-6 space-y-4">
            {dayActivities.map((activity) => {
              const config = TYPE_ICON_MAP[activity.activityType] ?? TYPE_ICON_MAP.NOTE
              const IconComponent = config.icon
              const isExpanded = expandedIds.has(activity.id)
              const time = format(new Date(activity.createdAt), "HH:mm")
              const hasDescription = activity.description && activity.description.length > 0

              return (
                <div
                  key={activity.id}
                  className="relative cursor-pointer group"
                  onClick={() => hasDescription && toggleExpand(activity.id)}
                >
                  {/* Punto del timeline (icono) */}
                  <div
                    className={cn(
                      "absolute -left-[34px] flex h-7 w-7 items-center justify-center rounded-full",
                      config.bg
                    )}
                  >
                    <IconComponent className={cn("h-3.5 w-3.5", config.color)} />
                  </div>

                  {/* Contenido de la actividad */}
                  <div className="rounded-lg border bg-card p-3 transition-colors group-hover:bg-muted/50">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        {/* Tipo y asunto */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-medium text-muted-foreground">
                            {ACTIVITY_TYPE_LABELS[activity.activityType] ?? activity.activityType}
                          </span>
                          {activity.duration_minutes && (
                            <span className="text-xs text-muted-foreground">
                              ({activity.duration_minutes} min)
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-sm font-medium leading-tight">
                          {activity.subject}
                        </p>

                        {/* Descripción (truncada o expandida) */}
                        {hasDescription && (
                          <p
                            className={cn(
                              "mt-1 text-xs text-muted-foreground",
                              !isExpanded && "line-clamp-2"
                            )}
                          >
                            {activity.description}
                          </p>
                        )}

                        {/* Resultado (si completada) */}
                        {activity.outcome && (
                          <p className="mt-1 text-xs text-green-700">
                            Resultado: {activity.outcome}
                          </p>
                        )}

                        {/* Usuario y hora */}
                        <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                          <span>{activity.user.name}</span>
                          <span>&middot;</span>
                          <span>{time}</span>
                        </div>
                      </div>

                      {/* Badge de fecha de vencimiento (solo tareas) */}
                      <div className="flex flex-col items-end gap-1">
                        {activity.dueDate &&
                          getDueDateBadge(new Date(activity.dueDate), activity.status)}
                        {activity.status === "COMPLETADA" && (
                          <Badge className="bg-green-100 text-green-700 text-xs">
                            Completada
                          </Badge>
                        )}
                        {activity.status === "CANCELADA" && (
                          <Badge variant="secondary" className="text-xs">
                            Cancelada
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
