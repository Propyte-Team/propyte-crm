// Tarjeta de KPI — Design System v2
"use client"

import { ArrowUpRight, ArrowDownRight } from "lucide-react"
import { type LucideIcon } from "lucide-react"

interface KpiCardProps {
  title: string
  value: string
  subtitle?: string
  icon: LucideIcon
  trend: number
  color?: string
  accentBg?: string
}

export function KpiCard({ title, value, subtitle, icon: Icon, trend, color, accentBg }: KpiCardProps) {
  const isPositive = trend >= 0
  const iconColor = color || "var(--color-teal)"
  const iconBg = accentBg || "var(--color-teal-light)"

  return (
    <div className="crm-card">
      <div className="flex items-center justify-between">
        <div
          className="flex h-9 w-9 items-center justify-center rounded-lg"
          style={{ background: iconBg }}
        >
          <Icon className="h-[18px] w-[18px]" style={{ color: iconColor }} />
        </div>
        <span
          className="inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-semibold"
          style={{
            background: isPositive ? "var(--color-success-bg)" : "var(--color-error-bg)",
            color: isPositive ? "var(--color-success)" : "var(--color-error)",
          }}
        >
          {isPositive ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
          {isPositive ? "+" : ""}{trend}%
        </span>
      </div>
      <div className="mt-4">
        <p className="text-2xl font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>{value}</p>
        <p className="mt-0.5 text-[13px] font-medium" style={{ color: "var(--text-secondary)" }}>{title}</p>
        {subtitle && <p className="mt-0.5 text-[11px]" style={{ color: "var(--text-tertiary)" }}>{subtitle}</p>}
      </div>
    </div>
  )
}
