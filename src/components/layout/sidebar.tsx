// Sidebar principal del CRM Propyte — Design System v2
"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useSession, signOut } from "next-auth/react"
import {
  LayoutDashboard,
  Users,
  Kanban,
  Building2,
  DollarSign,
  BarChart3,
  UserCheck,
  Settings,
  FolderSync,
  Megaphone,
  ChevronLeft,
  ChevronRight,
  Moon,
  Sun,
  LogOut,
} from "lucide-react"
import { useTheme } from "next-themes"
import { cn } from "@/lib/utils"

const navItems = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, roles: ["DIRECTOR", "GERENTE", "LIDER", "ASESOR", "BROKER", "HOSTESS"] },
  { label: "Contactos", href: "/contacts", icon: Users, roles: ["DIRECTOR", "GERENTE", "LIDER", "ASESOR", "BROKER", "HOSTESS"] },
  { label: "Pipeline", href: "/pipeline", icon: Kanban, roles: ["DIRECTOR", "GERENTE", "LIDER", "ASESOR", "BROKER"] },
  { label: "Desarrollos", href: "/developments", icon: Building2, roles: ["DIRECTOR", "GERENTE", "LIDER", "ASESOR", "BROKER"] },
  { label: "Comisiones", href: "/commissions", icon: DollarSign, roles: ["DIRECTOR", "GERENTE", "LIDER", "ASESOR", "BROKER"] },
  { label: "Reportes", href: "/reports", icon: BarChart3, roles: ["DIRECTOR", "GERENTE", "LIDER"] },
  { label: "Meta Ads", href: "/meta-ads", icon: Megaphone, roles: ["DIRECTOR", "GERENTE", "LIDER", "MARKETING"] },
  { label: "Walk-ins", href: "/walk-ins", icon: UserCheck, roles: ["HOSTESS"] },
  { label: "Sync Drive", href: "/sync", icon: FolderSync, roles: ["DIRECTOR", "GERENTE", "MANTENIMIENTO"] },
  { label: "Admin", href: "/admin", icon: Settings, roles: ["DIRECTOR", "GERENTE"] },
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

  const filteredNavItems = navItems.filter((item) =>
    userRole === "ADMIN" || item.roles.includes(userRole)
  )

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
          <div className="mx-auto flex h-7 w-7 items-center justify-center rounded-md" style={{ background: "var(--color-teal)" }}>
            <span className="text-xs font-bold text-white">P</span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md" style={{ background: "var(--color-teal)" }}>
              <span className="text-xs font-bold text-white">P</span>
            </div>
            <span className="text-sm font-semibold tracking-tight" style={{ color: "var(--text-primary)" }}>Propyte</span>
            <span className="rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider" style={{ background: "var(--color-teal-light)", color: "var(--color-teal)" }}>CRM</span>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <div className="space-y-0.5">
          {filteredNavItems.map((item) => {
            const isActive = pathname?.startsWith(item.href)
            const Icon = item.icon

            return (
              <Link
                key={item.href}
                href={item.href}
                title={collapsed ? item.label : undefined}
                className={cn(
                  "group relative flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13px] font-medium",
                  "transition-colors"
                )}
                style={{
                  background: isActive ? "var(--color-teal-light)" : "transparent",
                  color: isActive ? "var(--color-teal)" : "var(--text-secondary)",
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.background = "rgba(255,255,255,0.04)"
                    e.currentTarget.style.color = "var(--text-primary)"
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.background = "transparent"
                    e.currentTarget.style.color = "var(--text-secondary)"
                  }
                }}
              >
                {isActive && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[3px] rounded-r" style={{ background: "var(--color-teal)" }} />
                )}
                <Icon
                  className="h-4 w-4 shrink-0"
                  style={{ color: isActive ? "var(--color-teal)" : "var(--text-tertiary)" }}
                />
                {!collapsed && <span>{item.label}</span>}
              </Link>
            )
          })}
        </div>
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
              onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-primary)"; e.currentTarget.style.background = "rgba(255,255,255,0.06)" }}
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
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-primary)"; e.currentTarget.style.background = "rgba(255,255,255,0.06)" }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-tertiary)"; e.currentTarget.style.background = "transparent" }}
            title={collapsed ? "Expandir" : "Colapsar"}
          >
            {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
          </button>
        </div>

        {/* User */}
        <div className={cn("flex items-center gap-2 rounded-md p-2 cursor-default", collapsed && "justify-center p-1")}>
          <div
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
            style={{ background: "var(--color-teal)" }}
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
