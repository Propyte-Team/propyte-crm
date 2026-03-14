// Sidebar principal del CRM Propyte con navegación basada en roles
"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useSession } from "next-auth/react"
import {
  LayoutDashboard,
  Users,
  Kanban,
  Building2,
  DollarSign,
  BarChart3,
  UserCheck,
  Settings,
  ChevronLeft,
  ChevronRight,
  Moon,
  Sun,
} from "lucide-react"
import { useTheme } from "next-themes"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Separator } from "@/components/ui/separator"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { ScrollArea } from "@/components/ui/scroll-area"

// Elementos de navegación con control de acceso por rol
const navItems = [
  {
    label: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
    roles: ["DIRECTOR", "GERENTE", "LIDER", "ASESOR", "HOSTESS"],
  },
  {
    label: "Contactos",
    href: "/contacts",
    icon: Users,
    roles: ["DIRECTOR", "GERENTE", "LIDER", "ASESOR", "HOSTESS"],
  },
  {
    label: "Pipeline",
    href: "/pipeline",
    icon: Kanban,
    roles: ["DIRECTOR", "GERENTE", "LIDER", "ASESOR"],
  },
  {
    label: "Desarrollos",
    href: "/developments",
    icon: Building2,
    roles: ["DIRECTOR", "GERENTE", "LIDER", "ASESOR"],
  },
  {
    label: "Comisiones",
    href: "/commissions",
    icon: DollarSign,
    roles: ["DIRECTOR", "GERENTE", "LIDER", "ASESOR"],
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

  // Rol del usuario actual para filtrar navegación
  const userRole = (session?.user as { role?: string })?.role || "ASESOR"
  const userName = session?.user?.name || "Usuario"
  const userImage = session?.user?.image || ""

  // Iniciales del nombre para el avatar fallback
  const initials = userName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)

  // Filtrar items de navegación según el rol del usuario
  const filteredNavItems = navItems.filter((item) =>
    item.roles.includes(userRole)
  )

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        className={cn(
          "flex h-screen flex-col border-r bg-card transition-all duration-300",
          collapsed ? "w-[60px]" : "w-[260px]"
        )}
      >
        {/* Logo de Propyte */}
        <div className="flex h-16 items-center justify-between px-4">
          {!collapsed && (
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold text-primary">PROPYTE</span>
              <Badge variant="secondary" className="text-xs">
                CRM
              </Badge>
            </div>
          )}
          {collapsed && (
            <span className="mx-auto text-lg font-bold text-primary">P</span>
          )}
        </div>

        <Separator />

        {/* Navegación principal */}
        <ScrollArea className="flex-1 py-2">
          <nav className="flex flex-col gap-1 px-2">
            {filteredNavItems.map((item) => {
              const isActive = pathname?.startsWith(item.href)
              const Icon = item.icon

              // Si el sidebar está colapsado, mostrar tooltip con el nombre
              if (collapsed) {
                return (
                  <Tooltip key={item.href}>
                    <TooltipTrigger asChild>
                      <Link
                        href={item.href}
                        className={cn(
                          "flex h-10 w-10 items-center justify-center rounded-md mx-auto transition-colors",
                          isActive
                            ? "bg-secondary/10 text-secondary border-l-2 border-secondary"
                            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                        )}
                      >
                        <Icon className="h-5 w-5" />
                      </Link>
                    </TooltipTrigger>
                    <TooltipContent side="right">
                      {item.label}
                    </TooltipContent>
                  </Tooltip>
                )
              }

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-secondary/10 text-secondary border-l-2 border-secondary"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  )}
                >
                  <Icon className="h-5 w-5" />
                  <span>{item.label}</span>
                </Link>
              )
            })}
          </nav>
        </ScrollArea>

        <Separator />

        {/* Información del usuario y controles */}
        <div className="p-3">
          {/* Toggle de modo oscuro */}
          <div className={cn("flex mb-3", collapsed ? "justify-center" : "justify-end")}>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="h-8 w-8"
            >
              <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
              <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
              <span className="sr-only">Cambiar tema</span>
            </Button>
          </div>

          {/* Datos del usuario */}
          {!collapsed && (
            <div className="flex items-center gap-3">
              <Avatar className="h-9 w-9">
                <AvatarImage src={userImage} alt={userName} />
                <AvatarFallback className="text-xs">{initials}</AvatarFallback>
              </Avatar>
              <div className="flex flex-col overflow-hidden">
                <span className="truncate text-sm font-medium">{userName}</span>
                <Badge variant="outline" className="w-fit text-[10px]">
                  {userRole}
                </Badge>
              </div>
            </div>
          )}

          {collapsed && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Avatar className="mx-auto h-9 w-9 cursor-pointer">
                  <AvatarImage src={userImage} alt={userName} />
                  <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                </Avatar>
              </TooltipTrigger>
              <TooltipContent side="right">
                <p>{userName}</p>
                <p className="text-xs text-muted-foreground">{userRole}</p>
              </TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* Botón para colapsar/expandir */}
        <div className="border-t p-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-full"
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <>
                <ChevronLeft className="h-4 w-4 mr-2" />
                <span>Colapsar</span>
              </>
            )}
          </Button>
        </div>
      </aside>
    </TooltipProvider>
  )
}
