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
      {/* KPIs */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Deals Activos"
          value={activeDeals.toLocaleString("es-MX")}
          subtitle={`Valor ponderado: ${formatMXN(activeDealsValue)}`}
          trend={activeDealsTrend}
          icon={BarChart3}
          color="#60A5FA"
          accentBg="rgba(96, 165, 250, 0.12)"
        />
        <KpiCard
          title="Leads del Mes"
          value={newLeadsMonth.toLocaleString("es-MX")}
          trend={newLeadsTrend}
          icon={Users}
          color="#818CF8"
          accentBg="rgba(129, 140, 248, 0.12)"
        />
        <KpiCard
          title="Comisiones Pendientes"
          value={formatMXN(pendingCommissions)}
          trend={pendingCommissionsTrend}
          icon={DollarSign}
          color="#22C55E"
          accentBg="rgba(34, 197, 94, 0.12)"
        />
        <KpiCard
          title="Tasa de Conversión"
          value={`${conversionRate}%`}
          trend={conversionRateTrend}
          icon={TrendingUp}
          color="#F5A623"
          accentBg="rgba(245, 166, 35, 0.12)"
        />
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
