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
    <div className="crm-card">
      <div className="flex items-center justify-between">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: "var(--color-teal-light)" }}>
          <Icon className={cn("h-5 w-5", color ?? "text-[var(--color-teal)]")} style={{ color: color ? undefined : "var(--color-teal)" }} />
        </div>
        <span
          className="inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold"
          style={{
            background: isPositive ? "var(--color-success-bg)" : "var(--color-error-bg)",
            color: isPositive ? "var(--color-success)" : "var(--color-error)",
          }}
        >
          {isPositive ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
          {isPositive ? "+" : ""}{trend}%
        </span>
      </div>
      <div className="mt-3">
        <p className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>{value}</p>
        <p className="text-[13px]" style={{ color: "var(--text-secondary)" }}>{title}</p>
        {subtitle && <p className="mt-0.5 text-xs" style={{ color: "var(--text-tertiary)" }}>{subtitle}</p>}
      </div>
    </div>
  )
}
