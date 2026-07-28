// Config de navegación del sidebar — módulo PURO (testeable en node, sin React/Next).
// Roles alineados al enum UserRole de Prisma (ADMIN ve todo sin filtro).
// AUD-20260710-05: MANTENIMIENTO (y DEVELOPER_EXT) no aparecían en ningún grupo →
// sidebar vacío. nav-config.test.ts fija que TODO rol del enum vea al menos 1 item.
import {
  LayoutDashboard,
  Users,
  MessageSquare,
  Kanban,
  Building2,
  DollarSign,
  BarChart3,
  TrendingUp,
  UserCheck,
  Settings,
  Sun,
  CalendarCheck,
  FileText,
  Target,
  CopyCheck,
  Plug,
} from "lucide-react"

const ASESORES = ["ASESOR", "ASESOR_SR", "ASESOR_JR"]
// MANTENIMIENTO/DEVELOPER_EXT entran a los básicos (Hoy/Dashboard/Contactos/Mi Config):
// las APIs ya les dan acceso (FULL_ACCESS_ROLES en /api/contacts, /api/dashboard, etc.).
const TODOS = ["DIRECTOR", "GERENTE", "TEAM_LEADER", ...ASESORES, "BROKER", "HOSTESS", "MARKETING", "MANTENIMIENTO", "DEVELOPER_EXT"]

export interface NavItem {
  label: string
  href: string
  icon: typeof LayoutDashboard
  roles: string[]
}

export const navGroups: Array<{ title: string | null; items: NavItem[] }> = [
  {
    title: null,
    items: [
      { label: "Hoy", href: "/hoy", icon: Sun, roles: TODOS },
      { label: "Agenda", href: "/agenda", icon: CalendarCheck, roles: TODOS },
      { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, roles: TODOS },
      { label: "Inbox", href: "/inbox", icon: MessageSquare, roles: ["DIRECTOR", "GERENTE", "TEAM_LEADER", ...ASESORES, "MARKETING"] },
    ],
  },
  {
    title: "Ventas",
    items: [
      { label: "Contactos", href: "/contacts", icon: Users, roles: TODOS },
      { label: "Pipeline", href: "/pipeline", icon: Kanban, roles: ["DIRECTOR", "GERENTE", "TEAM_LEADER", ...ASESORES, "BROKER", "MANTENIMIENTO"] },
      { label: "Cotizaciones", href: "/cotizaciones", icon: FileText, roles: ["DIRECTOR", "GERENTE", "TEAM_LEADER", "BROKER", ...ASESORES] },
      { label: "Desarrollos", href: "/developments", icon: Building2, roles: ["DIRECTOR", "GERENTE", "TEAM_LEADER", ...ASESORES, "BROKER", "MARKETING", "MANTENIMIENTO", "DEVELOPER_EXT"] },
      { label: "Walk-ins", href: "/walk-ins", icon: UserCheck, roles: ["DIRECTOR", "GERENTE", "HOSTESS", "MANTENIMIENTO"] },
    ],
  },
  {
    title: "Desempeño",
    items: [
      { label: "Comisiones", href: "/commissions", icon: DollarSign, roles: ["DIRECTOR", "GERENTE", "TEAM_LEADER", ...ASESORES, "BROKER"] },
      { label: "Cobranza", href: "/cobranza", icon: DollarSign, roles: ["DIRECTOR", "GERENTE", "TEAM_LEADER", ...ASESORES] },
      { label: "Metas", href: "/metas", icon: Target, roles: ["DIRECTOR", "GERENTE", "TEAM_LEADER", ...ASESORES] },
      { label: "Reportes", href: "/reports", icon: BarChart3, roles: ["DIRECTOR", "GERENTE", "TEAM_LEADER", "MARKETING", "MANTENIMIENTO"] },
      { label: "Mi Carrera", href: "/career", icon: TrendingUp, roles: ["TEAM_LEADER", ...ASESORES] },
    ],
  },
  {
    title: "Sistema",
    items: [
      { label: "Mi Config", href: "/settings", icon: UserCheck, roles: TODOS },
      { label: "Configuración", href: "/configuracion", icon: Settings, roles: ["DIRECTOR", "GERENTE"] },
      { label: "Duplicados", href: "/duplicados", icon: CopyCheck, roles: ["ADMIN", "DIRECTOR", "MANTENIMIENTO"] },
      { label: "Conexiones", href: "/conexiones", icon: Plug, roles: ["ADMIN", "DIRECTOR", "GERENTE", "MARKETING"] },
    ],
  },
]

/** Items visibles para un rol (ADMIN ve todo) — misma regla que renderiza el Sidebar. */
export function visibleNavItems(role: string): NavItem[] {
  return navGroups.flatMap((g) =>
    g.items.filter((item) => role === "ADMIN" || item.roles.includes(role))
  )
}
