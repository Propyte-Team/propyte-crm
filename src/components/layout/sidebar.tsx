// Sidebar principal del CRM Propyte — Estilo HubSpot
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

// Navegación con control de acceso por rol
const navItems = [
  {
    label: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
    roles: ["DIRECTOR", "GERENTE", "LIDER", "ASESOR", "BROKER", "HOSTESS"],
  },
  {
    label: "Contactos",
    href: "/contacts",
    icon: Users,
    roles: ["DIRECTOR", "GERENTE", "LIDER", "ASESOR", "BROKER", "HOSTESS"],
  },
  {
    label: "Pipeline",
    href: "/pipeline",
    icon: Kanban,
    roles: ["DIRECTOR", "GERENTE", "LIDER", "ASESOR", "BROKER"],
  },
  {
    label: "Desarrollos",
    href: "/developments",
    icon: Building2,
    roles: ["DIRECTOR", "GERENTE", "LIDER", "ASESOR", "BROKER"],
  },
  {
    label: "Comisiones",
    href: "/commissions",
    icon: DollarSign,
    roles: ["DIRECTOR", "GERENTE", "LIDER", "ASESOR", "BROKER"],
  },
  {
    label: "Reportes",
    href: "/reports",
    icon: BarChart3,
    roles: ["DIRECTOR", "GERENTE", "LIDER"],
  },
  {
    label: "Walk-ins",
    href: "/walk-ins",
    icon: UserCheck,
    roles: ["HOSTESS"],
  },
  {
    label: "Sync Drive",
    href: "/sync",
    icon: FolderSync,
    roles: ["DIRECTOR", "GERENTE", "MANTENIMIENTO"],
  },
  {
    label: "Admin",
    href: "/admin",
    icon: Settings,
    roles: ["DIRECTOR", "GERENTE"],
  },
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

  // ADMIN ve todo; otros roles se filtran
  const filteredNavItems = navItems.filter((item) =>
    userRole === "ADMIN" || item.roles.includes(userRole)
  )

  return (
    <aside
      className={cn(
        "flex h-screen flex-col bg-propyte-aztec text-white transition-all duration-200 select-none",
        collapsed ? "w-[56px]" : "w-[220px]"
      )}
    >
      {/* Logo */}
      <div className="flex h-14 items-center px-3">
        {collapsed ? (
          <div className="mx-auto flex h-8 w-8 items-center justify-center rounded-lg bg-propyte-aqua/15">
            <span className="text-sm font-bold text-propyte-aqua">P</span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-propyte-aqua/15">
              <span className="text-sm font-bold text-propyte-aqua">P</span>
            </div>
            <span className="text-base font-semibold tracking-tight">Propyte</span>
            <span className="rounded bg-propyte-aqua/15 px-1.5 py-0.5 text-[10px] font-medium text-propyte-aqua">
              CRM
            </span>
          </div>
        )}
      </div>

      {/* Navegación */}
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
                  "group flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors",
                  isActive
                    ? "bg-propyte-aqua/10 text-propyte-aqua"
                    : "text-gray-400 hover:bg-white/5 hover:text-gray-200"
                )}
              >
                <Icon className={cn(
                  "h-[18px] w-[18px] shrink-0",
                  isActive ? "text-propyte-aqua" : "text-gray-500 group-hover:text-gray-300"
                )} />
                {!collapsed && <span>{item.label}</span>}
              </Link>
            )
          })}
        </div>
      </nav>

      {/* Footer: usuario + controles */}
      <div className="border-t border-white/10 p-2">
        {/* Tema + Colapsar */}
        <div className={cn("flex gap-1 mb-2", collapsed ? "flex-col items-center" : "justify-end")}>
          <button
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="flex h-7 w-7 items-center justify-center rounded-md text-gray-500 hover:bg-white/10 hover:text-gray-300 transition-colors"
            title="Cambiar tema"
          >
            <Sun className="h-3.5 w-3.5 dark:hidden" />
            <Moon className="hidden h-3.5 w-3.5 dark:block" />
          </button>
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="flex h-7 w-7 items-center justify-center rounded-md text-gray-500 hover:bg-white/10 hover:text-gray-300 transition-colors"
            title={collapsed ? "Expandir" : "Colapsar"}
          >
            {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
          </button>
        </div>

        {/* Usuario */}
        <div className={cn(
          "flex items-center gap-2 rounded-md p-2 hover:bg-white/5 transition-colors cursor-default",
          collapsed && "justify-center p-1"
        )}>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-propyte-teal text-[11px] font-semibold text-white">
            {initials}
          </div>
          {!collapsed && (
            <div className="flex flex-1 flex-col overflow-hidden">
              <span className="truncate text-xs font-medium text-gray-200">{userName}</span>
              <span className="text-[10px] text-propyte-aqua">{userRole}</span>
            </div>
          )}
          {!collapsed && (
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="flex h-7 w-7 items-center justify-center rounded-md text-gray-500 hover:bg-white/10 hover:text-red-400 transition-colors"
              title="Cerrar sesión"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </aside>
  )
}
