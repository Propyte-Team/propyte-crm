// Barra superior del CRM — Design System v2
"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useSession, signOut } from "next-auth/react"
import { Search, Bell, LogOut } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
// Las opciones de sistema salieron del sidebar y viven aquí (pedido de Luis, ago-2026).
// Se importan de nav-config para que sidebar y menú compartan UNA sola definición de roles.
import { visibleUserMenuItems } from "./nav-config"

const MODULE_LABELS: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/hoy": "Hoy",
  "/agenda": "Agenda",
  "/contacts": "Contactos",
  "/inbox": "Inbox",
  "/pipeline": "Negocios",
  "/cotizaciones": "Cotizaciones",
  "/cobranza": "Cobranza",
  "/developments": "Desarrollos",
  "/commissions": "Comisiones",
  "/metas": "Metas",
  "/reports": "Reportes",
  "/career": "Mi Carrera",
  "/settings": "Mi Perfil",
  "/walk-ins": "Walk-ins",
  "/duplicados": "Duplicados",
  "/conexiones": "Conexiones",
  "/admin": "Configuración",
  "/configuracion": "Configuración",
}

export function Topbar() {
  const pathname = usePathname()
  const { data: session } = useSession()
  const moduleLabel =
    Object.entries(MODULE_LABELS).find(([href]) => pathname?.startsWith(href))?.[1] ?? ""
  const [unreadCount, setUnreadCount] = React.useState(0)

  // Conteo real de notificaciones no leídas
  React.useEffect(() => {
    if (!session?.user) return
    fetch("/api/notifications?unreadOnly=true&pageSize=1")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (typeof data?.unreadCount === "number") setUnreadCount(data.unreadCount)
      })
      .catch(() => {})
  }, [session?.user])

  const userName = session?.user?.name || "Usuario"
  const userEmail = session?.user?.email || ""
  const userRole = (session?.user as { role?: string })?.role || "ASESOR"
  const menuItems = React.useMemo(() => visibleUserMenuItems(userRole), [userRole])

  const initials = userName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)

  return (
    <header
      className="flex h-12 items-center justify-between px-4"
      style={{ background: "var(--bg-sidebar)", borderBottom: "1px solid var(--border-subtle)" }}
    >
      {/* Módulo activo + búsqueda con hint de teclado */}
      <div className="flex items-center gap-4">
        <span className="text-[13px] font-semibold tracking-tight" style={{ color: "var(--text-primary)" }}>
          {moduleLabel}
        </span>
        <div className="relative hidden w-72 sm:block">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style={{ color: "var(--text-tertiary)" }} />
          <input
            type="text"
            placeholder="Buscar contactos, deals..."
            className="form-input py-1.5 pl-8 pr-12 text-[13px]"
            style={{ background: "var(--bg-input)", height: "32px" }}
          />
          <span className="kbd absolute right-2 top-1/2 -translate-y-1/2">⌘K</span>
        </div>
      </div>

      {/* Right actions */}
      <div className="flex items-center gap-2">
        {/* Role badge */}
        <span
          className="rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
          style={{ background: "var(--color-teal-light)", color: "var(--color-teal)" }}
        >
          {userRole}
        </span>

        {/* Notifications */}
        <button
          className="relative flex h-8 w-8 items-center justify-center rounded-md transition-colors"
          style={{ color: "var(--text-secondary)" }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)" }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent" }}
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span
              className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-white"
              style={{ background: "var(--color-error)" }}
            >
              {unreadCount}
            </span>
          )}
        </button>

        {/* User dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex h-8 w-8 items-center justify-center rounded-full text-[10px] font-semibold" style={{ background: "var(--color-teal)", color: "var(--text-inverse)" }}>
              {initials}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56" align="end" forceMount>
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium leading-none">{userName}</p>
                <p className="text-xs leading-none text-muted-foreground">{userEmail}</p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {/* Antes había dos items sin `href` que no navegaban a ningún lado.
                Ahora cada uno es un Link real y la lista se filtra por rol. */}
            {menuItems.map((item) => {
              const Icon = item.icon
              return (
                <DropdownMenuItem key={item.href} asChild>
                  <Link href={item.href} className="cursor-pointer">
                    <Icon className="mr-2 h-4 w-4" />
                    <span>{item.label}</span>
                  </Link>
                </DropdownMenuItem>
              )
            })}
            {menuItems.length > 0 && <DropdownMenuSeparator />}
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => signOut()}
            >
              <LogOut className="mr-2 h-4 w-4" />
              <span>Cerrar Sesión</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
