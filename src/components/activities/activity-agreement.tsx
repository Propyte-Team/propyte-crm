// ============================================================
// Widget de progreso del acuerdo de actividad
// Muestra métricas diarias y semanales con barras de progreso
// ============================================================
"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

// Interfaz de métrica individual
interface AgreementMetric {
  label: string
  current: number
  target: number
  percentage: number
  period: string
}

// Interfaz de respuesta del progreso
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

  // Cargar datos del progreso desde la API del dashboard
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
        // Error silencioso
      } finally {
        setLoading(false)
      }
    }
    fetchProgress()
  }, [userId])

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Acuerdo de Actividad</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </CardContent>
      </Card>
    )
  }

  if (!data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Acuerdo de Actividad</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Sin datos disponibles</p>
        </CardContent>
      </Card>
    )
  }

  // Determinar color según porcentaje
  function getProgressColor(percentage: number): string {
    if (percentage >= 100) return "bg-green-500"
    if (percentage >= 70) return "bg-amber-500"
    return "bg-red-500"
  }

  // Determinar color del badge de cumplimiento general
  function getOverallBadge(percentage: number) {
    if (percentage >= 100) {
      return <Badge className="bg-green-100 text-green-700">{percentage}%</Badge>
    }
    if (percentage >= 70) {
      return <Badge className="bg-amber-100 text-amber-700">{percentage}%</Badge>
    }
    return <Badge variant="destructive">{percentage}%</Badge>
  }

  // Separar métricas por período
  const dailyMetrics = data.metrics.filter((m) => m.period === "daily")
  const weeklyMetrics = data.metrics.filter((m) => m.period === "weekly")

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">Acuerdo de Actividad</CardTitle>
          {getOverallBadge(data.overallPercentage)}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Métricas diarias */}
        {dailyMetrics.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
              Hoy
            </p>
            <div className="space-y-3">
              {dailyMetrics.map((metric) => (
                <MetricBar key={metric.label} metric={metric} getColor={getProgressColor} />
              ))}
            </div>
          </div>
        )}

        {/* Métricas semanales */}
        {weeklyMetrics.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
              Esta semana
            </p>
            <div className="space-y-3">
              {weeklyMetrics.map((metric) => (
                <MetricBar key={metric.label} metric={metric} getColor={getProgressColor} />
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// Componente interno: barra de progreso de una métrica
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
        <span className="text-xs font-medium">{metric.label}</span>
        <span className="text-xs text-muted-foreground">
          {metric.current} / {metric.target}
        </span>
      </div>
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full transition-all", getColor(metric.percentage))}
          style={{ width: `${capped}%` }}
        />
      </div>
    </div>
  )
}
