// Barra superior del CRM — Design System v2
"use client"

import * as React from "react"
import { useSession, signOut } from "next-auth/react"
import { Search, Bell, User, TrendingUp, LogOut } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export function Topbar() {
  const { data: session } = useSession()
  const [unreadCount] = React.useState(3)

  const userName = session?.user?.name || "Usuario"
  const userEmail = session?.user?.email || ""
  const userRole = (session?.user as { role?: string })?.role || "ASESOR"

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
      {/* Search */}
      <div className="relative w-full max-w-sm">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style={{ color: "var(--text-tertiary)" }} />
        <input
          type="text"
          placeholder="Buscar contactos, deals..."
          className="form-input pl-8 py-1.5 text-[13px]"
          style={{ background: "var(--bg-input)", height: "32px" }}
        />
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
          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.06)" }}
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
            <button className="flex h-8 w-8 items-center justify-center rounded-full text-[10px] font-semibold text-white" style={{ background: "var(--color-teal)" }}>
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
            <DropdownMenuItem>
              <User className="mr-2 h-4 w-4" />
              <span>Mi Perfil</span>
            </DropdownMenuItem>
            <DropdownMenuItem>
              <TrendingUp className="mr-2 h-4 w-4" />
              <span>Plan de Carrera</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
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
