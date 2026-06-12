// Sidebar principal del CRM Propyte — Design System v2
"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useSession, signOut } from "next-auth/react"
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
  ChevronLeft,
  ChevronRight,
  Moon,
  Sun,
  LogOut,
  FileText,
} from "lucide-react"
import { useTheme } from "next-themes"
import { cn } from "@/lib/utils"

// Roles alineados al enum UserRole de Prisma (ADMIN ve todo sin filtro).
// Nav agrupado: el ritmo visual viene de las secciones, no de una lista plana.
const ASESORES = ["ASESOR", "ASESOR_SR", "ASESOR_JR"]
const TODOS = ["DIRECTOR", "GERENTE", "TEAM_LEADER", ...ASESORES, "BROKER", "HOSTESS", "MARKETING"]
const navGroups: Array<{ title: string | null; items: Array<{ label: string; href: string; icon: typeof LayoutDashboard; roles: string[] }> }> = [
  {
    title: null,
    items: [
      { label: "Hoy", href: "/hoy", icon: Sun, roles: TODOS },
      { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, roles: TODOS },
      { label: "Inbox", href: "/inbox", icon: MessageSquare, roles: ["DIRECTOR", "GERENTE", "TEAM_LEADER", ...ASESORES, "MARKETING"] },
    ],
  },
  {
    title: "Ventas",
    items: [
      { label: "Contactos", href: "/contacts", icon: Users, roles: TODOS },
      { label: "Pipeline", href: "/pipeline", icon: Kanban, roles: ["DIRECTOR", "GERENTE", "TEAM_LEADER", ...ASESORES, "BROKER"] },
      { label: "Cotizaciones", href: "/cotizaciones", icon: FileText, roles: ["DIRECTOR", "GERENTE", "TEAM_LEADER", "BROKER", ...ASESORES] },
      { label: "Desarrollos", href: "/developments", icon: Building2, roles: ["DIRECTOR", "GERENTE", "TEAM_LEADER", ...ASESORES, "BROKER", "MARKETING"] },
      { label: "Walk-ins", href: "/walk-ins", icon: UserCheck, roles: ["DIRECTOR", "GERENTE", "HOSTESS"] },
    ],
  },
  {
    title: "Desempeno",
    items: [
      { label: "Comisiones", href: "/commissions", icon: DollarSign, roles: ["DIRECTOR", "GERENTE", "TEAM_LEADER", ...ASESORES, "BROKER"] },
      { label: "Cobranza", href: "/cobranza", icon: DollarSign, roles: ["DIRECTOR", "GERENTE", "TEAM_LEADER", ...ASESORES] },
      { label: "Reportes", href: "/reports", icon: BarChart3, roles: ["DIRECTOR", "GERENTE", "TEAM_LEADER", "MARKETING"] },
      { label: "Mi Carrera", href: "/career", icon: TrendingUp, roles: ["TEAM_LEADER", ...ASESORES] },
    ],
  },
  {
    title: "Sistema",
    items: [
      { label: "Mi Config", href: "/settings", icon: UserCheck, roles: TODOS },
      { label: "Configuracion", href: "/configuracion", icon: Settings, roles: ["DIRECTOR", "GERENTE"] },
      { label: "Admin", href: "/admin", icon: Settings, roles: ["DIRECTOR", "GERENTE"] },
    ],
  },
]

export function Sidebar() {
  const pathname = usePathname()
  const { data: session } = useSession()
  const { resolvedTheme, setTheme } = useTheme()
  const [collapsed, setCollapsed] = React.useState(false)
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => setMounted(true), [])

  const userRole = (session?.user as { role?: string })?.role || "ASESOR"
  const userName = session?.user?.name || "Usuario"

  const initials = userName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)

  const isDark = resolvedTheme === "dark"

  return (
    <aside
      className={cn(
        "flex h-screen flex-col select-none transition-all duration-200",
        collapsed ? "w-[56px]" : "w-[200px]"
      )}
      style={{ background: "var(--bg-sidebar)", borderRight: "1px solid var(--border-subtle)" }}
    >
      {/* Logo */}
      <div className="flex h-12 items-center px-3" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
        {collapsed ? (
          <span className="mx-auto text-[15px] font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>P.</span>
        ) : (
          <div className="flex items-baseline gap-1.5">
            <span className="text-[16px] font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>Propyte</span>
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--text-tertiary)" }}>CRM</span>
          </div>
        )}
      </div>

      {/* Navigation agrupada */}
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {navGroups.map((group) => {
          const items = group.items.filter((item) => userRole === "ADMIN" || item.roles.includes(userRole))
          if (items.length === 0) return null
          return (
            <div key={group.title ?? "_top"} className="mb-4 last:mb-0">
              {group.title && !collapsed && (
                <p className="mb-1 px-2.5 text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--text-tertiary)" }}>
                  {group.title}
                </p>
              )}
              <div className="space-y-px">
                {items.map((item) => {
                  const isActive = pathname?.startsWith(item.href)
                  const Icon = item.icon
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      title={collapsed ? item.label : undefined}
                      className="group relative flex items-center gap-2.5 rounded-md px-2.5 py-[6px] text-[13px] transition-colors"
                      style={{
                        color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
                        fontWeight: isActive ? 600 : 450,
                      }}
                      onMouseEnter={(e) => {
                        if (!isActive) e.currentTarget.style.color = "var(--text-primary)"
                      }}
                      onMouseLeave={(e) => {
                        if (!isActive) e.currentTarget.style.color = "var(--text-secondary)"
                      }}
                    >
                      {isActive && (
                        <span className="absolute left-0 top-1/2 h-3.5 w-[2px] -translate-y-1/2 rounded-r" style={{ background: "var(--text-primary)" }} />
                      )}
                      <Icon
                        className="h-4 w-4 shrink-0 transition-colors"
                        style={{ color: isActive ? "var(--text-primary)" : "var(--text-tertiary)" }}
                        strokeWidth={isActive ? 2.2 : 1.8}
                      />
                      {!collapsed && <span>{item.label}</span>}
                    </Link>
                  )
                })}
              </div>
            </div>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="p-2" style={{ borderTop: "1px solid var(--border-subtle)" }}>
        {/* Theme + Collapse */}
        <div className={cn("flex gap-1 mb-2", collapsed ? "flex-col items-center" : "justify-end")}>
          {mounted && (
            <button
              onClick={() => setTheme(isDark ? "light" : "dark")}
              className="flex h-7 w-7 items-center justify-center rounded-md transition-colors"
              style={{ color: "var(--text-tertiary)" }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-primary)"; e.currentTarget.style.background = "var(--bg-hover)" }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-tertiary)"; e.currentTarget.style.background = "transparent" }}
              title={isDark ? "Modo claro" : "Modo oscuro"}
            >
              {isDark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            </button>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="flex h-7 w-7 items-center justify-center rounded-md transition-colors"
            style={{ color: "var(--text-tertiary)" }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-primary)"; e.currentTarget.style.background = "var(--bg-hover)" }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-tertiary)"; e.currentTarget.style.background = "transparent" }}
            title={collapsed ? "Expandir" : "Colapsar"}
          >
            {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
          </button>
        </div>

        {/* User */}
        <div className={cn("flex items-center gap-2 rounded-md p-2 cursor-default", collapsed && "justify-center p-1")}>
          <div
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold"
            style={{ background: "var(--color-teal)", color: "var(--text-inverse)" }}
          >
            {initials}
          </div>
          {!collapsed && (
            <div className="flex flex-1 flex-col overflow-hidden">
              <span className="truncate text-xs font-medium" style={{ color: "var(--text-primary)" }}>{userName}</span>
              <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--color-teal)" }}>{userRole}</span>
            </div>
          )}
          {!collapsed && (
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="flex h-7 w-7 items-center justify-center rounded-md transition-colors"
              style={{ color: "var(--text-tertiary)" }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "#EF4444" }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-tertiary)" }}
              title="Cerrar sesion"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </aside>
  )
}
