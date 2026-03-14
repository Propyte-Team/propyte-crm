// Gráfico de barras del pipeline de ventas con datos reales
// Props: stageData con stage, label, count, value
"use client"

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatMXN } from "@/lib/constants"

interface PipelineStageData {
  stage: string
  label: string
  count: number
  value: number
}

interface PipelineChartProps {
  stageData: PipelineStageData[]
}

// Tooltip personalizado para mostrar cantidad y valor en MXN
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null

  const data = payload[0].payload as PipelineStageData

  return (
    <div className="rounded-lg border bg-background p-3 shadow-sm">
      <p className="text-sm font-medium">{data.label}</p>
      <p className="text-sm text-muted-foreground">
        {data.count} {data.count === 1 ? "deal" : "deals"}
      </p>
      <p className="text-sm font-medium text-primary">
        {formatMXN(data.value)}
      </p>
    </div>
  )
}

export function PipelineChart({ stageData }: PipelineChartProps) {
  // Preparar datos con etiquetas cortas para el eje X
  const chartData = stageData.map((s) => ({
    ...s,
    etapa: s.label,
    cantidad: s.count,
  }))

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Pipeline de Ventas</CardTitle>
      </CardHeader>
      <CardContent>
        {chartData.length === 0 ? (
          <div className="flex h-72 items-center justify-center text-muted-foreground">
            Sin datos de pipeline
          </div>
        ) : (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartData}
                margin={{ top: 5, right: 20, left: 0, bottom: 45 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis
                  dataKey="etapa"
                  tick={{ fontSize: 11 }}
                  angle={-35}
                  textAnchor="end"
                  interval={0}
                />
                <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                <Tooltip content={<CustomTooltip />} />
                <Bar
                  dataKey="cantidad"
                  fill="#1E3A5F"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={40}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
