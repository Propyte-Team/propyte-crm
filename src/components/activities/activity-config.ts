// Icono y colores por tipo de actividad. Vivía en components/dashboard/recent-activities.tsx;
// se movió aquí al retirar el Dashboard (#890) porque la página de Actividades lo usa.
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

export const ACTIVITY_CONFIG: Record<string, { icon: LucideIcon; color: string; bg: string }> = {
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
