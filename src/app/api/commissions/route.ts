// ============================================================
// API Route: /api/commissions
// Consulta de comisiones por usuario y deal
// GET - Listar comisiones con filtros de estado
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { Prisma } from "@prisma/client";

// Roles con acceso completo a todas las comisiones
const FULL_ACCESS_ROLES = ["ADMIN", "DIRECTOR", "GERENTE", "DEVELOPER_EXT", "MANTENIMIENTO"];
// Roles con acceso a comisiones de su equipo
const TEAM_ACCESS_ROLES = ["ADMIN", "TEAM_LEADER"];
// Roles con acceso solo a sus propias comisiones
const OWN_ACCESS_ROLES = ["ASESOR", "ASESOR_SR", "ASESOR_JR", "BROKER"];

/**
 * GET /api/commissions
 * Lista comisiones de deals (basado en campos de comisión del deal).
 * Filtra por usuario, deal y estado de la comisión.
 */
export async function GET(request: NextRequest) {
  try {
    // Verificar autenticación
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);

    // Parámetros de filtro
    const userId = searchParams.get("userId") || undefined;
    const dealId = searchParams.get("dealId") || undefined;
    const commissionStatus = searchParams.get("status") || undefined;
    const stage = searchParams.get("dealStage") || undefined;

    const userRole = session.user.role;
    const currentUserId = session.user.id;

    // Construir filtros del deal (las comisiones están en el modelo Deal)
    const where: Prisma.DealWhereInput = {
      deletedAt: null,
    };

    // Filtrar por acceso según rol
    if (OWN_ACCESS_ROLES.includes(userRole)) {
      // Solo comisiones de deals propios
      where.assignedToId = currentUserId;
    } else if (TEAM_ACCESS_ROLES.includes(userRole)) {
      // Comisiones de deals del equipo
      const teamMembers = await prisma.user.findMany({
        where: { teamLeaderId: currentUserId },
        select: { id: true },
      });
      const teamIds = [currentUserId, ...teamMembers.map((m) => m.id)];
      where.assignedToId = { in: teamIds };
    } else if (!FULL_ACCESS_ROLES.includes(userRole)) {
      return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
    }

    // Filtros específicos
    if (userId) {
      where.assignedToId = userId;
    }
    if (dealId) {
      where.id = dealId;
    }
    if (commissionStatus) {
      where.commissionStatus = commissionStatus as any;
    }
    // Solo deals que tienen comisiones relevantes (etapas avanzadas)
    if (stage) {
      where.stage = stage as any;
    } else {
      // Por defecto, mostrar solo deals en etapas con comisión potencial
      where.stage = {
        in: ["RESERVED", "CONTRACT_SIGNED", "CLOSING", "WON"],
      };
    }

    // Ejecutar consulta
    const deals = await prisma.deal.findMany({
      where,
      select: {
        id: true,
        stage: true,
        dealType: true,
        estimatedValue: true,
        currency: true,
        commissionTotal: true,
        commissionAdvisor: true,
        commissionTL: true,
        commissionGerente: true,
        commissionDirector: true,
        commissionBrokerExt: true,
        commissionStatus: true,
        leadSourceAtDeal: true,
        actualCloseDate: true,
        contact: {
          select: { id: true, firstName: true, lastName: true },
        },
        assignedTo: {
          select: { id: true, name: true, role: true },
        },
        development: {
          select: { id: true, name: true },
        },
        unit: {
          select: { id: true, unitNumber: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // Calcular totales agregados
    const totals = {
      totalDeals: deals.length,
      totalCommissions: deals.reduce(
        (sum, d) => sum + (d.commissionTotal ? Number(d.commissionTotal) : 0),
        0
      ),
      pendiente: deals.filter((d) => d.commissionStatus === "PENDIENTE").length,
      facturada: deals.filter((d) => d.commissionStatus === "FACTURADA").length,
      pagada: deals.filter((d) => d.commissionStatus === "PAGADA").length,
    };

    return NextResponse.json({
      data: deals,
      totals,
    });
  } catch (error) {
    console.error("Error al listar comisiones:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
