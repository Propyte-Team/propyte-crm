// Spend + Leads chart — Design System v2
"use client"

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Line,
  ComposedChart,
  Bar,
} from "recharts"
import type { MetaDailyData } from "@/lib/meta/types"

interface SpendChartProps {
  data: MetaDailyData[]
}

function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00")
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "short" })
}

function formatMXN(value: number): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(value)
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null

  return (
    <div
      className="rounded-lg px-3 py-2 text-sm shadow-lg"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border-default)",
        color: "var(--text-primary)",
      }}
    >
      <p className="mb-1 font-medium" style={{ color: "var(--text-secondary)" }}>
        {formatShortDate(label)}
      </p>
      {payload.map((p: any) => (
        <p key={p.dataKey} style={{ color: p.color }}>
          {p.dataKey === "spend" ? `Gasto: ${formatMXN(p.value)}` : `Leads: ${p.value}`}
        </p>
      ))}
      {payload[0]?.payload?.cpl > 0 && (
        <p style={{ color: "var(--text-tertiary)" }}>
          CPL: {formatMXN(payload[0].payload.cpl)}
        </p>
      )}
    </div>
  )
}

export function SpendChart({ data }: SpendChartProps) {
  return (
    <div className="crm-card">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-[15px] font-semibold" style={{ color: "var(--text-primary)" }}>
          Gasto y Leads Diarios
        </h3>
        <div className="flex items-center gap-4 text-[11px]" style={{ color: "var(--text-tertiary)" }}>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: "#60A5FA" }} />
            Gasto
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: "#22C55E" }} />
            Leads
          </span>
        </div>
      </div>
      {data.length === 0 ? (
        <div className="flex h-64 items-center justify-center text-sm" style={{ color: "var(--text-tertiary)" }}>
          Sin datos disponibles
        </div>
      ) : (
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 5, right: 12, left: -8, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={formatShortDate}
                tick={{ fontSize: 10, fill: "var(--text-tertiary)" }}
                axisLine={{ stroke: "var(--border-subtle)" }}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                yAxisId="spend"
                tick={{ fontSize: 11, fill: "var(--text-tertiary)" }}
                tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                yAxisId="leads"
                orientation="right"
                tick={{ fontSize: 11, fill: "var(--text-tertiary)" }}
                allowDecimals={false}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(0, 180, 200, 0.06)" }} />
              <Area
                yAxisId="spend"
                type="monotone"
                dataKey="spend"
                stroke="#60A5FA"
                fill="rgba(96, 165, 250, 0.15)"
                strokeWidth={2}
              />
              <Bar
                yAxisId="leads"
                dataKey="leads"
                fill="#22C55E"
                radius={[3, 3, 0, 0]}
                maxBarSize={16}
                opacity={0.8}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
