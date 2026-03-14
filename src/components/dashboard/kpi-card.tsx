// Tarjeta reutilizable de KPI para el dashboard
// Props: title, value, subtitle, icon, trend, color
"use client"

import { ArrowUpRight, ArrowDownRight } from "lucide-react"
import { type LucideIcon } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

interface KpiCardProps {
  title: string
  value: string
  subtitle?: string
  icon: LucideIcon
  trend: number // positivo = sube, negativo = baja
  color?: string // clase de color del icono (ej: "text-blue-600")
}

export function KpiCard({ title, value, subtitle, icon: Icon, trend, color }: KpiCardProps) {
  const isPositive = trend >= 0

  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          {/* Icono en círculo con color de fondo */}
          <div className={cn("rounded-full bg-primary/10 p-3")}>
            <Icon className={cn("h-5 w-5", color ?? "text-primary")} />
          </div>

          {/* Badge de tendencia con flecha */}
          <span
            className={cn(
              "inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold",
              isPositive
                ? "bg-green-100 text-green-700"
                : "bg-red-100 text-red-700"
            )}
          >
            {isPositive ? (
              <ArrowUpRight className="h-3 w-3" />
            ) : (
              <ArrowDownRight className="h-3 w-3" />
            )}
            {isPositive ? "+" : ""}
            {trend}%
          </span>
        </div>

        {/* Valor principal */}
        <div className="mt-4">
          <p className="text-2xl font-bold">{value}</p>
          <p className="text-sm text-muted-foreground">{title}</p>
          {subtitle && (
            <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
