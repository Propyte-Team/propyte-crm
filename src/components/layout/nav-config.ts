// Config de navegación del sidebar — módulo PURO (testeable en node, sin React/Next).
// Roles alineados al enum UserRole de Prisma (ADMIN ve todo sin filtro).
// AUD-20260710-05: MANTENIMIENTO (y DEVELOPER_EXT) no aparecían en ningún grupo →
// sidebar vacío. nav-config.test.ts fija que TODO rol del enum vea al menos 1 item.
//
// ORDEN (pedido de Luis, ago-2026): el sidebar sigue el flujo del día del asesor —
// primero lo operativo (Hoy → Inbox → Agenda), luego el embudo en su orden real
// (Contactos → Negocios → Cotizaciones), y al final los números. Dashboard baja al
// cuarto lugar: es panorámica, no acción diaria.
// Las opciones de sistema YA NO viven aquí: salen en el menú del nombre (Topbar),
// ver `userMenuItems` abajo.
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
import { COMMENT_RULES_ROLES } from "@/lib/comments/roles"

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
      { label: "Inbox", href: "/inbox", icon: MessageSquare, roles: ["DIRECTOR", "GERENTE", "TEAM_LEADER", ...ASESORES, "MARKETING"] },
      { label: "Agenda", href: "/agenda", icon: CalendarCheck, roles: TODOS },
      { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, roles: TODOS },
    ],
  },
  {
    title: "Ventas",
    items: [
      { label: "Contactos", href: "/contacts", icon: Users, roles: TODOS },
      // "Negocios" (antes "Pipeline"): la ruta /pipeline NO cambia — renombrar la URL
      // rompería enlaces guardados y notificaciones ya emitidas.
      { label: "Negocios", href: "/pipeline", icon: Kanban, roles: ["DIRECTOR", "GERENTE", "TEAM_LEADER", ...ASESORES, "BROKER", "MANTENIMIENTO"] },
      { label: "Cotizaciones", href: "/cotizaciones", icon: FileText, roles: ["DIRECTOR", "GERENTE", "TEAM_LEADER", "BROKER", ...ASESORES] },
      { label: "Desarrollos", href: "/developments", icon: Building2, roles: ["DIRECTOR", "GERENTE", "TEAM_LEADER", ...ASESORES, "BROKER", "MARKETING", "MANTENIMIENTO", "DEVELOPER_EXT"] },
      { label: "Walk-ins", href: "/walk-ins", icon: UserCheck, roles: ["DIRECTOR", "GERENTE", "HOSTESS", "MANTENIMIENTO"] },
    ],
  },
  {
    title: "Desempeño",
    items: [
      { label: "Metas", href: "/metas", icon: Target, roles: ["DIRECTOR", "GERENTE", "TEAM_LEADER", ...ASESORES] },
      { label: "Comisiones", href: "/commissions", icon: DollarSign, roles: ["DIRECTOR", "GERENTE", "TEAM_LEADER", ...ASESORES, "BROKER"] },
      { label: "Cobranza", href: "/cobranza", icon: DollarSign, roles: ["DIRECTOR", "GERENTE", "TEAM_LEADER", ...ASESORES] },
      { label: "Mi Carrera", href: "/career", icon: TrendingUp, roles: ["TEAM_LEADER", ...ASESORES] },
      { label: "Reportes", href: "/reports", icon: BarChart3, roles: ["DIRECTOR", "GERENTE", "TEAM_LEADER", "MARKETING", "MANTENIMIENTO"] },
    ],
  },
]

// Opciones de sistema: salen del sidebar y viven en el menú del nombre (Topbar).
// Mismo contrato que NavItem y MISMOS roles que tenían en el sidebar — mover de
// superficie no cambia quién las ve.
export const userMenuItems: NavItem[] = [
  { label: "Mi Perfil", href: "/settings", icon: UserCheck, roles: TODOS },
  { label: "Configuración", href: "/configuracion", icon: Settings, roles: ["DIRECTOR", "GERENTE"] },
  { label: "Conexiones", href: "/conexiones", icon: Plug, roles: ["ADMIN", "DIRECTOR", "GERENTE", "MARKETING"] },
  { label: "Duplicados", href: "/duplicados", icon: CopyCheck, roles: ["ADMIN", "DIRECTOR", "MANTENIMIENTO"] },
  // Puerta directa a /admin/comentarios: MARKETING no puede entrar por
  // /admin?tab=comments (esa página exige rol de administración). Los roles
  // se leen del módulo de permiso para que el menú y la API no se separen.
  { label: "Comentarios", href: "/admin/comentarios", icon: MessageSquare, roles: [...COMMENT_RULES_ROLES] },
]

/** Items del sidebar visibles para un rol (ADMIN ve todo) — misma regla que renderiza el Sidebar. */
export function visibleNavItems(role: string): NavItem[] {
  return navGroups.flatMap((g) =>
    g.items.filter((item) => role === "ADMIN" || item.roles.includes(role))
  )
}

/** Items del menú del nombre visibles para un rol (ADMIN ve todo) — misma regla que el Topbar. */
export function visibleUserMenuItems(role: string): NavItem[] {
  return userMenuItems.filter((item) => role === "ADMIN" || item.roles.includes(role))
}
