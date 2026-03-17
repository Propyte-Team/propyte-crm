// ============================================================
// API Route: /api/dashboard
// Obtener datos del dashboard según el rol del usuario
// GET — Retorna KPIs, pipeline, actividades, métricas
// ============================================================

import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "@/lib/auth/session"
import { getDashboardStats } from "@/server/dashboard"
import { getActivityAgreementProgress } from "@/server/activities"

/**
 * GET /api/dashboard
 * Retorna datos completos del dashboard basados en rol y plaza del usuario.
 * Parámetros opcionales:
 *   - section: "agreement" para solo devolver progreso de acuerdo
 *   - userId: ID del usuario (para gerentes consultando asesores)
 */
export async function GET(request: NextRequest) {
  try {
    // Verificar autenticación
    const session = await getServerSession()
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const section = searchParams.get("section")
    const requestedUserId = searchParams.get("userId")

    // Si se pide solo el progreso de acuerdo
    if (section === "agreement") {
      const targetUserId = requestedUserId ?? session.user.id

      // RBAC: solo el propio usuario o roles superiores pueden ver el progreso de otro
      const allowedToViewOthers = ["ADMIN", "DIRECTOR", "GERENTE", "TEAM_LEADER", "DEVELOPER_EXT", "MANTENIMIENTO"]
      if (targetUserId !== session.user.id && !allowedToViewOthers.includes(session.user.role)) {
        return NextResponse.json({ error: "Acceso denegado" }, { status: 403 })
      }

      // Calcular inicio de semana (lunes)
      const now = new Date()
      const weekStart = new Date(now)
      const dayOfWeek = weekStart.getDay()
      const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1
      weekStart.setDate(weekStart.getDate() - diff)
      weekStart.setHours(0, 0, 0, 0)

      const agreementProgress = await getActivityAgreementProgress(targetUserId, weekStart)
      return NextResponse.json({ agreementProgress })
    }

    // Dashboard completo
    const stats = await getDashboardStats(
      session.user.id,
      session.user.role,
      session.user.plaza
    )

    return NextResponse.json(stats)
  } catch (error) {
    console.error("Error al obtener dashboard:", error)
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    )
  }
}
