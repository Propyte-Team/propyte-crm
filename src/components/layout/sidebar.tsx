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
  { label: "Walk-ins", href: "/walk-ins", icon: UserCheck, roles: ["HOSTESS"] },
  { label: "Sync Drive", href: "/sync", icon: FolderSync, roles: ["DIRECTOR", "GERENTE", "MANTENIMIENTO"] },
  { label: "Admin", href: "/admin", icon: Settings, roles: ["DIRECTOR", "GERENTE"] },
]

export function Sidebar() {
  const pathname = usePathname()
  const { data: session } = useSession()
  const { theme, setTheme } = useTheme()
  const [collapsed, setCollapsed] = React.useState(false)

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

  return (
    <aside
      className={cn(
        "flex h-screen flex-col select-none transition-all duration-200",
        collapsed ? "w-[56px]" : "w-[180px]"
      )}
      style={{ background: "var(--bg-sidebar)", borderRight: "1px solid var(--border-subtle)" }}
    >
      {/* Logo */}
      <div className="flex h-14 items-center px-3" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
        {collapsed ? (
          <div className="mx-auto flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: "var(--color-teal-light)" }}>
            <span className="text-sm font-bold" style={{ color: "var(--color-teal)" }}>P</span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: "var(--color-teal-light)" }}>
              <span className="text-sm font-bold" style={{ color: "var(--color-teal)" }}>P</span>
            </div>
            <span className="text-base font-semibold tracking-tight" style={{ color: "var(--text-primary)" }}>Propyte</span>
            <span className="rounded px-1.5 py-0.5 text-[10px] font-medium" style={{ background: "var(--color-teal-light)", color: "var(--color-teal)" }}>CRM</span>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 py-2">
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
                  "group flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium",
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
                <Icon
                  className="h-[16px] w-[16px] shrink-0"
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
          <button
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="flex h-7 w-7 items-center justify-center rounded-md transition-colors"
            style={{ color: "var(--text-tertiary)" }}
            title="Cambiar tema"
          >
            <Sun className="h-3.5 w-3.5 dark:hidden" />
            <Moon className="hidden h-3.5 w-3.5 dark:block" />
          </button>
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="flex h-7 w-7 items-center justify-center rounded-md transition-colors"
            style={{ color: "var(--text-tertiary)" }}
            title={collapsed ? "Expandir" : "Colapsar"}
          >
            {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
          </button>
        </div>

        {/* User */}
        <div className={cn("flex items-center gap-2 rounded-md p-2 cursor-default", collapsed && "justify-center p-1")}>
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
            style={{ background: "var(--color-teal)" }}
          >
            {initials}
          </div>
          {!collapsed && (
            <div className="flex flex-1 flex-col overflow-hidden">
              <span className="truncate text-xs font-medium" style={{ color: "var(--text-primary)" }}>{userName}</span>
              <span className="text-[10px]" style={{ color: "var(--color-teal)" }}>{userRole}</span>
            </div>
          )}
          {!collapsed && (
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:text-red-400"
              style={{ color: "var(--text-tertiary)" }}
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
