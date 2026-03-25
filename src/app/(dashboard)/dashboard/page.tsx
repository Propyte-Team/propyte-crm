// Página principal del dashboard — componente de servidor
// Obtiene datos reales de Prisma y pasa como props al contenido cliente
import { getServerSession } from "@/lib/auth/session"
import { redirect } from "next/navigation"
import { ROLE_LABELS } from "@/lib/constants"
import { DashboardContent } from "@/components/dashboard/dashboard-content"
import { getDashboardStats } from "@/server/dashboard"

export default async function DashboardPage() {
  // Verificar autenticación
  const session = await getServerSession()
  if (!session?.user) {
    redirect("/login")
  }

  const userId = session.user.id
  const userName = session.user.name ?? "Usuario"
  const userRole = session.user.role ?? "ASESOR"
  const userPlaza = session.user.plaza
  const roleLabel = ROLE_LABELS[userRole] ?? userRole

  // Obtener estadísticas del dashboard desde la base de datos
  let stats
  try {
    stats = await getDashboardStats(userId, userRole, userPlaza)
  } catch (error) {
    console.error("Error al cargar dashboard:", error)
    // Valores por defecto en caso de error
    stats = {
      activeDeals: 0,
      activeDealsValue: 0,
      newLeadsMonth: 0,
      pendingCommissions: 0,
      conversionRate: 0,
      activeDealsTrend: 0,
      newLeadsTrend: 0,
      pendingCommissionsTrend: 0,
      conversionRateTrend: 0,
      pipelineData: [],
      recentActivities: [],
      overdueTasksCount: 0,
      agreementProgress: null,
      advisorStats: undefined,
      monthlyTrend: [],
    }
  }

  // Serializar fechas para pasar como props al componente cliente
  const serializedActivities = stats.recentActivities.map((a) => ({
    ...a,
    createdAt: a.createdAt instanceof Date ? a.createdAt.toISOString() : a.createdAt,
  }))

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>
          Bienvenido, {userName}
        </h1>
        <p className="text-[13px]" style={{ color: "var(--text-secondary)" }}>
          Resumen general de tu operación
        </p>
      </div>

      {/* Contenido principal del dashboard con datos reales */}
      <DashboardContent
        role={userRole}
        name={userName}
        userId={userId}
        activeDeals={stats.activeDeals}
        activeDealsValue={stats.activeDealsValue}
        newLeadsMonth={stats.newLeadsMonth}
        pendingCommissions={stats.pendingCommissions}
        conversionRate={stats.conversionRate}
        activeDealsTrend={stats.activeDealsTrend}
        newLeadsTrend={stats.newLeadsTrend}
        pendingCommissionsTrend={stats.pendingCommissionsTrend}
        conversionRateTrend={stats.conversionRateTrend}
        pipelineData={stats.pipelineData}
        recentActivities={serializedActivities}
        overdueTasksCount={stats.overdueTasksCount}
        advisorStats={stats.advisorStats}
        monthlyTrend={stats.monthlyTrend}
      />
    </div>
  )
}
