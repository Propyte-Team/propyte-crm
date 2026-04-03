// Widget de acuerdo de actividad — Design System v2
"use client"

import { useState, useEffect } from "react"
import { cn } from "@/lib/utils"

interface AgreementMetric {
  label: string
  current: number
  target: number
  percentage: number
  period: string
}

interface AgreementProgressData {
  metrics: AgreementMetric[]
  overallPercentage: number
}

interface ActivityAgreementProps {
  userId: string
}

export function ActivityAgreement({ userId }: ActivityAgreementProps) {
  const [data, setData] = useState<AgreementProgressData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchProgress() {
      try {
        const res = await fetch(`/api/dashboard?section=agreement&userId=${userId}`)
        if (res.ok) {
          const json = await res.json()
          if (json.agreementProgress) {
            setData(json.agreementProgress)
          }
        }
      } catch {
        // silent
      } finally {
        setLoading(false)
      }
    }
    fetchProgress()
  }, [userId])

  if (loading) {
    return (
      <div className="crm-card">
        <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>Acuerdo de Actividad</h3>
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-8 rounded-md animate-pulse" style={{ background: "var(--bg-input)" }} />
          ))}
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="crm-card">
        <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>Acuerdo de Actividad</h3>
        <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>Sin datos disponibles</p>
      </div>
    )
  }

  function getBarColor(percentage: number): string {
    if (percentage >= 100) return "var(--color-success)"
    if (percentage >= 70) return "var(--color-amber)"
    return "var(--color-error)"
  }

  function getOverallBadgeStyle(percentage: number) {
    if (percentage >= 100) return { background: "var(--color-success-bg)", color: "var(--color-success)" }
    if (percentage >= 70) return { background: "var(--color-warning-bg)", color: "var(--color-warning)" }
    return { background: "var(--color-error-bg)", color: "var(--color-error)" }
  }

  const dailyMetrics = data.metrics.filter((m) => m.period === "daily")
  const weeklyMetrics = data.metrics.filter((m) => m.period === "weekly")

  return (
    <div className="crm-card">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Acuerdo de Actividad</h3>
        <span
          className="badge font-semibold"
          style={getOverallBadgeStyle(data.overallPercentage)}
        >
          {data.overallPercentage}%
        </span>
      </div>

      <div className="space-y-4">
        {dailyMetrics.length > 0 && (
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>
              Hoy
            </p>
            <div className="space-y-3">
              {dailyMetrics.map((metric) => (
                <MetricBar key={metric.label} metric={metric} getColor={getBarColor} />
              ))}
            </div>
          </div>
        )}

        {weeklyMetrics.length > 0 && (
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>
              Esta semana
            </p>
            <div className="space-y-3">
              {weeklyMetrics.map((metric) => (
                <MetricBar key={metric.label} metric={metric} getColor={getBarColor} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function MetricBar({
  metric,
  getColor,
}: {
  metric: AgreementMetric
  getColor: (pct: number) => string
}) {
  const capped = Math.min(metric.percentage, 100)

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>{metric.label}</span>
        <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
          {metric.current} / {metric.target}
        </span>
      </div>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--border-subtle)" }}>
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${capped}%`, background: getColor(metric.percentage) }}
        />
      </div>
    </div>
  )
}
