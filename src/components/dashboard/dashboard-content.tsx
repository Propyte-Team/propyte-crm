// Contenido principal del dashboard con datos reales de Prisma
// Conectado a la API /api/dashboard, sin datos mock
"use client"

import { DollarSign, Users, TrendingUp, BarChart3, AlertTriangle } from "lucide-react"
import { KpiCard } from "@/components/dashboard/kpi-card"
import { PipelineChart } from "@/components/dashboard/pipeline-chart"
import { RecentActivities } from "@/components/dashboard/recent-activities"
import { ActivityAgreement } from "@/components/activities/activity-agreement"
import { OverdueTasks } from "@/components/activities/overdue-tasks"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { formatMXN } from "@/lib/constants"

// Tipos de datos del dashboard (coinciden con DashboardStats del server)
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
  // KPIs
  activeDeals: number
  activeDealsValue: number
  newLeadsMonth: number
  pendingCommissions: number
  conversionRate: number
  // Tendencias
  activeDealsTrend: number
  newLeadsTrend: number
  pendingCommissionsTrend: number
  conversionRateTrend: number
  // Pipeline
  pipelineData: PipelineStageData[]
  // Actividades recientes
  recentActivities: RecentActivity[]
  // Tareas vencidas
  overdueTasksCount: number
  // Estadísticas por asesor (gerentes/directores)
  advisorStats?: AdvisorStat[]
  // Tendencia mensual
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
  monthlyTrend,
}: DashboardContentProps) {
  // Verificar si el rol es de asesor (muestra acuerdo de actividad)
  const isAdvisor = ["ASESOR_SR", "ASESOR_JR"].includes(role)
  // Verificar si el rol es gerencial (muestra tabla de asesores)
  const isManager = ["GERENTE", "DIRECTOR", "TEAM_LEADER"].includes(role)

  return (
    <div className="space-y-6">
      {/* Tarjetas de KPIs principales */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Deals Activos"
          value={activeDeals.toLocaleString("es-MX")}
          subtitle={`Valor ponderado: ${formatMXN(activeDealsValue)}`}
          trend={activeDealsTrend}
          icon={BarChart3}
          color="text-blue-600"
        />
        <KpiCard
          title="Leads del Mes"
          value={newLeadsMonth.toLocaleString("es-MX")}
          trend={newLeadsTrend}
          icon={Users}
          color="text-indigo-600"
        />
        <KpiCard
          title="Comisiones Pendientes"
          value={formatMXN(pendingCommissions)}
          trend={pendingCommissionsTrend}
          icon={DollarSign}
          color="text-green-600"
        />
        <KpiCard
          title="Tasa de Conversión"
          value={`${conversionRate}%`}
          trend={conversionRateTrend}
          icon={TrendingUp}
          color="text-orange-600"
        />
      </div>

      {/* Sección de gráfico de pipeline + widgets laterales */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Pipeline (2/3 del ancho) */}
        <div className="lg:col-span-2">
          <PipelineChart stageData={pipelineData} />
        </div>

        {/* Panel lateral (1/3): acuerdo de actividad + tareas vencidas */}
        <div className="space-y-4">
          {isAdvisor && <ActivityAgreement userId={userId} />}
          <OverdueTasks />
        </div>
      </div>

      {/* Actividades recientes */}
      <RecentActivities activities={recentActivities} />

      {/* Tabla de asesores (solo gerentes/directores/team leaders) */}
      {isManager && advisorStats && advisorStats.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Rendimiento por Asesor</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-3 font-medium">Asesor</th>
                    <th className="pb-3 font-medium">Deals Activos</th>
                    <th className="pb-3 font-medium">Valor Total</th>
                    <th className="pb-3 font-medium">Actividades (semana)</th>
                    <th className="pb-3 font-medium">Tareas Vencidas</th>
                  </tr>
                </thead>
                <tbody>
                  {advisorStats.map((advisor) => (
                    <tr
                      key={advisor.id}
                      className="border-b last:border-0 hover:bg-muted/50"
                    >
                      <td className="py-3 font-medium">{advisor.name}</td>
                      <td className="py-3">{advisor.activeDeals}</td>
                      <td className="py-3">{formatMXN(advisor.totalValue)}</td>
                      <td className="py-3">{advisor.activitiesThisWeek}</td>
                      <td className="py-3">
                        {advisor.overdueTasksCount > 0 ? (
                          <Badge variant="destructive" className="text-xs">
                            <AlertTriangle className="mr-1 h-3 w-3" />
                            {advisor.overdueTasksCount}
                          </Badge>
                        ) : (
                          <Badge className="bg-green-100 text-green-700 text-xs">0</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
