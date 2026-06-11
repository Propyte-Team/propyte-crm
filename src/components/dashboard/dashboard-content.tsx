// Contenido principal del dashboard — Design System v2
"use client"

import { DollarSign, Users, TrendingUp, BarChart3, AlertTriangle } from "lucide-react"
import { KpiCard } from "@/components/dashboard/kpi-card"
import { PipelineChart } from "@/components/dashboard/pipeline-chart"
import { RecentActivities } from "@/components/dashboard/recent-activities"
import { ActivityAgreement } from "@/components/activities/activity-agreement"
import { OverdueTasks } from "@/components/activities/overdue-tasks"
import { formatMXN } from "@/lib/constants"

interface PipelineStageData {
  stage: string
  label: string
  count: number
  value: number
}

interface RecentActivity {
  id: string
  activityType: string
  subject: string
  createdAt: string | Date
  contact: { firstName: string; lastName: string }
  user: { name: string }
}

interface AdvisorStat {
  id: string
  name: string
  activeDeals: number
  totalValue: number
  activitiesThisWeek: number
  overdueTasksCount: number
}

interface MonthlyTrendItem {
  month: string
  deals: number
  value: number
  won: number
}

interface DashboardContentProps {
  role: string
  name: string
  userId: string
  activeDeals: number
  activeDealsValue: number
  newLeadsMonth: number
  pendingCommissions: number
  conversionRate: number
  activeDealsTrend: number
  newLeadsTrend: number
  pendingCommissionsTrend: number
  conversionRateTrend: number
  pipelineData: PipelineStageData[]
  recentActivities: RecentActivity[]
  overdueTasksCount: number
  advisorStats?: AdvisorStat[]
  monthlyTrend: MonthlyTrendItem[]
}

export function DashboardContent({
  role,
  name,
  userId,
  activeDeals,
  activeDealsValue,
  newLeadsMonth,
  pendingCommissions,
  conversionRate,
  activeDealsTrend,
  newLeadsTrend,
  pendingCommissionsTrend,
  conversionRateTrend,
  pipelineData,
  recentActivities,
  overdueTasksCount,
  advisorStats,
}: DashboardContentProps) {
  const isAdvisor = ["ASESOR", "ASESOR_SR", "ASESOR_JR", "BROKER"].includes(role)
  const isManager = ["ADMIN", "GERENTE", "DIRECTOR", "TEAM_LEADER"].includes(role)

  return (
    <div className="space-y-5">
      {/* Stat strip: una sola superficie dividida por hairlines, cifras grandes en mono.
          Sin iconos decorativos: el dato ES el protagonista (speckit de diseño). */}
      <div className="stat-strip grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Deals activos", value: activeDeals.toLocaleString("es-MX"), sub: `${formatMXN(activeDealsValue)} ponderado`, trend: activeDealsTrend },
          { label: "Leads del mes", value: newLeadsMonth.toLocaleString("es-MX"), sub: "captados este mes", trend: newLeadsTrend },
          { label: "Comisiones pendientes", value: formatMXN(pendingCommissions), sub: "por facturar", trend: pendingCommissionsTrend },
          { label: "Conversión", value: `${conversionRate}%`, sub: "lead a ganado", trend: conversionRateTrend },
        ].map((kpi) => (
          <div key={kpi.label} className="stat-cell">
            <div className="flex items-center justify-between gap-2">
              <span className="stat-label">{kpi.label}</span>
              {typeof kpi.trend === "number" && kpi.trend !== 0 && (
                <span
                  className="num text-[11px] font-semibold"
                  style={{ color: kpi.trend > 0 ? "var(--color-success)" : "var(--color-error)" }}
                >
                  {kpi.trend > 0 ? "+" : ""}{kpi.trend}%
                </span>
              )}
            </div>
            <p className="stat-value">{kpi.value}</p>
            <p className="stat-sub">{kpi.sub}</p>
          </div>
        ))}
      </div>

      {/* Pipeline + side widgets */}
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <PipelineChart stageData={pipelineData} />
        </div>
        <div className="space-y-4">
          {isAdvisor && <ActivityAgreement userId={userId} />}
          <OverdueTasks />
        </div>
      </div>

      {/* Recent activities */}
      <RecentActivities activities={recentActivities} />

      {/* Advisor table (managers only) */}
      {isManager && advisorStats && advisorStats.length > 0 && (
        <div className="crm-card">
          <h3 className="mb-4 text-[15px] font-semibold" style={{ color: "var(--text-primary)" }}>
            Rendimiento por Asesor
          </h3>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Asesor</th>
                  <th>Deals Activos</th>
                  <th>Valor Total</th>
                  <th>Actividades (semana)</th>
                  <th>Tareas Vencidas</th>
                </tr>
              </thead>
              <tbody>
                {advisorStats.map((advisor) => (
                  <tr key={advisor.id}>
                    <td className="font-medium">{advisor.name}</td>
                    <td>{advisor.activeDeals}</td>
                    <td>{formatMXN(advisor.totalValue)}</td>
                    <td>{advisor.activitiesThisWeek}</td>
                    <td>
                      {advisor.overdueTasksCount > 0 ? (
                        <span className="badge badge-error">
                          <AlertTriangle className="mr-1 h-3 w-3" />
                          {advisor.overdueTasksCount}
                        </span>
                      ) : (
                        <span className="badge badge-success">0</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
