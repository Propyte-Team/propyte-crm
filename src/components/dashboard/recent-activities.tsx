// Widget de actividades recientes — Design System v2
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

const ACTIVITY_CONFIG: Record<string, { icon: LucideIcon; color: string; bg: string }> = {
  CALL_OUTBOUND:     { icon: Phone,          color: "#60A5FA", bg: "rgba(96, 165, 250, 0.12)" },
  CALL_INBOUND:      { icon: Phone,          color: "#93C5FD", bg: "rgba(147, 197, 253, 0.12)" },
  WHATSAPP_OUT:      { icon: MessageSquare,  color: "#22C55E", bg: "rgba(34, 197, 94, 0.12)" },
  WHATSAPP_IN:       { icon: MessageSquare,  color: "#4ADE80", bg: "rgba(74, 222, 128, 0.12)" },
  EMAIL_SENT:        { icon: Mail,           color: "#A78BFA", bg: "rgba(167, 139, 250, 0.12)" },
  EMAIL_RECEIVED:    { icon: Mail,           color: "#C4B5FD", bg: "rgba(196, 181, 253, 0.12)" },
  MEETING_VIRTUAL:   { icon: Users,          color: "#818CF8", bg: "rgba(129, 140, 248, 0.12)" },
  MEETING_PRESENTIAL:{ icon: Users,          color: "#6366F1", bg: "rgba(99, 102, 241, 0.12)" },
  MEETING_SHOWROOM:  { icon: Users,          color: "#A5B4FC", bg: "rgba(165, 180, 252, 0.12)" },
  DISCOVERY_CALL:    { icon: ClipboardCheck, color: "#00B4C8", bg: "rgba(0, 180, 200, 0.12)" },
  PROPOSAL_DELIVERY: { icon: FileText,       color: "#F5A623", bg: "rgba(245, 166, 35, 0.12)" },
  FOLLOW_UP:         { icon: Bell,           color: "#FBBF24", bg: "rgba(251, 191, 36, 0.12)" },
  WALK_IN:           { icon: MapPin,         color: "#EC4899", bg: "rgba(236, 72, 153, 0.12)" },
  NOTE:              { icon: StickyNote,     color: "#EAB308", bg: "rgba(234, 179, 8, 0.12)" },
  TASK:              { icon: CheckSquare,    color: "#94A3B8", bg: "rgba(148, 163, 184, 0.12)" },
  CONTRACT_REVIEW:   { icon: FileSignature,  color: "#22D3EE", bg: "rgba(34, 211, 238, 0.12)" },
  CLOSING_ACTIVITY:  { icon: Trophy,         color: "#34D399", bg: "rgba(52, 211, 153, 0.12)" },
}

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
    <div className="crm-card">
      <h3 className="mb-4 text-[15px] font-semibold" style={{ color: "var(--text-primary)" }}>
        Actividades Recientes
      </h3>
      {activities.length === 0 ? (
        <p className="py-4 text-sm" style={{ color: "var(--text-tertiary)" }}>Sin actividades recientes</p>
      ) : (
        <div className="space-y-3">
          {activities.map((activity) => {
            const config = ACTIVITY_CONFIG[activity.activityType] ?? ACTIVITY_CONFIG.NOTE
            const IconComponent = config.icon

            const timeAgo = formatDistanceToNow(new Date(activity.createdAt), {
              addSuffix: true,
              locale: es,
            })

            return (
              <div key={activity.id} className="flex items-start gap-3">
                <div
                  className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                  style={{ background: config.bg }}
                >
                  <IconComponent className="h-4 w-4" style={{ color: config.color }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium leading-tight truncate" style={{ color: "var(--text-primary)" }}>
                    {activity.subject}
                  </p>
                  <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                    {activity.contact.firstName} {activity.contact.lastName}
                  </p>
                  <p className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                    {timeAgo}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="mt-4 pt-3" style={{ borderTop: "1px solid var(--border-subtle)" }}>
        <a
          href="/activities"
          className="text-[13px] font-medium transition-colors"
          style={{ color: "var(--color-teal)" }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--color-teal-dark)" }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--color-teal)" }}
        >
          Ver todas &rarr;
        </a>
      </div>
    </div>
  )
}
