// Widget de actividades recientes con datos reales
// Muestra las últimas 10 actividades con iconos, tiempo relativo y enlace
"use client"

import { formatDistanceToNow } from "date-fns"
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

// Mapa de iconos y colores por tipo de actividad
const ACTIVITY_CONFIG: Record<string, { icon: LucideIcon; color: string }> = {
  CALL_OUTBOUND: { icon: Phone, color: "text-blue-600" },
  CALL_INBOUND: { icon: Phone, color: "text-blue-400" },
  WHATSAPP_OUT: { icon: MessageSquare, color: "text-green-600" },
  WHATSAPP_IN: { icon: MessageSquare, color: "text-green-400" },
  EMAIL_SENT: { icon: Mail, color: "text-purple-600" },
  EMAIL_RECEIVED: { icon: Mail, color: "text-purple-400" },
  MEETING_VIRTUAL: { icon: Users, color: "text-indigo-600" },
  MEETING_PRESENTIAL: { icon: Users, color: "text-indigo-700" },
  MEETING_SHOWROOM: { icon: Users, color: "text-indigo-500" },
  DISCOVERY_CALL: { icon: ClipboardCheck, color: "text-teal-600" },
  PROPOSAL_DELIVERY: { icon: FileText, color: "text-orange-600" },
  FOLLOW_UP: { icon: Bell, color: "text-amber-600" },
  WALK_IN: { icon: MapPin, color: "text-pink-600" },
  NOTE: { icon: StickyNote, color: "text-yellow-600" },
  TASK: { icon: CheckSquare, color: "text-slate-600" },
  CONTRACT_REVIEW: { icon: FileSignature, color: "text-cyan-600" },
  CLOSING_ACTIVITY: { icon: Trophy, color: "text-emerald-600" },
}

// Interfaz de actividad reciente
interface RecentActivityItem {
  id: string
  activityType: string
  subject: string
  createdAt: string | Date
  contact: { firstName: string; lastName: string }
  user: { name: string }
}

interface RecentActivitiesProps {
  activities: RecentActivityItem[]
}

export function RecentActivities({ activities }: RecentActivitiesProps) {
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="text-lg">Actividades Recientes</CardTitle>
      </CardHeader>
      <CardContent>
        {activities.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">Sin actividades recientes</p>
        ) : (
          <div className="space-y-4">
            {activities.map((activity) => {
              const config = ACTIVITY_CONFIG[activity.activityType] ?? ACTIVITY_CONFIG.NOTE
              const IconComponent = config.icon

              // Calcular tiempo relativo en español
              const timeAgo = formatDistanceToNow(new Date(activity.createdAt), {
                addSuffix: true,
                locale: es,
              })

              return (
                <div key={activity.id} className="flex items-start gap-3">
                  {/* Icono de tipo de actividad */}
                  <div className="mt-0.5 rounded-full bg-muted p-2">
                    <IconComponent className={`h-4 w-4 ${config.color}`} />
                  </div>

                  {/* Asunto, contacto y tiempo */}
                  <div className="flex-1 space-y-1 min-w-0">
                    <p className="text-sm leading-tight truncate">
                      {activity.subject}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {activity.contact.firstName} {activity.contact.lastName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {timeAgo}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Enlace para ver todas las actividades */}
        <div className="mt-4 border-t pt-4">
          <a
            href="/activities"
            className="text-sm font-medium text-primary hover:underline"
          >
            Ver todas &rarr;
          </a>
        </div>
      </CardContent>
    </Card>
  )
}
