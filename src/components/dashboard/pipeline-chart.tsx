// Pipeline chart — Design System v2 (dark teal theme)
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

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const data = payload[0].payload as PipelineStageData

  return (
    <div
      className="rounded-lg px-3 py-2 text-sm shadow-lg"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border-default)",
        color: "var(--text-primary)",
      }}
    >
      <p className="font-medium" style={{ color: "var(--color-teal)" }}>{data.label}</p>
      <p style={{ color: "var(--text-secondary)" }}>
        {data.count} {data.count === 1 ? "deal" : "deals"}
      </p>
      <p className="font-semibold">{formatMXN(data.value)}</p>
    </div>
  )
}

export function PipelineChart({ stageData }: PipelineChartProps) {
  const chartData = stageData.map((s) => ({
    ...s,
    etapa: s.label,
    cantidad: s.count,
  }))

  return (
    <div className="crm-card">
      <h3 className="mb-4 text-[15px] font-semibold" style={{ color: "var(--text-primary)" }}>
        Pipeline de Ventas
      </h3>
      {chartData.length === 0 ? (
        <div className="flex h-64 items-center justify-center text-sm" style={{ color: "var(--text-tertiary)" }}>
          Sin datos de pipeline
        </div>
      ) : (
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              margin={{ top: 5, right: 12, left: -8, bottom: 45 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--border-subtle)"
                vertical={false}
              />
              <XAxis
                dataKey="etapa"
                tick={{ fontSize: 10, fill: "var(--text-tertiary)" }}
                angle={-35}
                textAnchor="end"
                interval={0}
                axisLine={{ stroke: "var(--border-subtle)" }}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "var(--text-tertiary)" }}
                allowDecimals={false}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(0, 180, 200, 0.06)" }} />
              <Bar
                dataKey="cantidad"
                fill="#00B4C8"
                radius={[4, 4, 0, 0]}
                maxBarSize={36}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
