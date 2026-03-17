// ============================================================
// API Route: /api/deals
// Gestión de operaciones/pipeline de ventas
// GET  - Listar deals con paginación y filtros (RBAC)
// POST - Crear un nuevo deal
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { Prisma } from "@prisma/client";
import { DEAL_STAGE_PROBABILITY } from "@/lib/constants";

// Roles con acceso completo a todos los deals
const FULL_ACCESS_ROLES = ["ADMIN", "DIRECTOR"];
// Roles con acceso a deals de su plaza
const PLAZA_ACCESS_ROLES = ["ADMIN", "GERENTE"];
// Roles con acceso a deals de su equipo
const TEAM_ACCESS_ROLES = ["ADMIN", "TEAM_LEADER"];
// Roles con acceso solo a sus deals
const OWN_ACCESS_ROLES = ["ASESOR", "ASESOR_SR", "ASESOR_JR", "BROKER"];
// Roles con acceso de solo lectura
const READ_ONLY_ROLES = ["MARKETING", "HOSTESS", "DEVELOPER_EXT", "MANTENIMIENTO"];

// Esquema de validación para crear deal
const createDealSchema = z.object({
  contactId: z.string().uuid("ID de contacto inválido"),
  developmentId: z.string().uuid("ID de desarrollo inválido").optional(),
  unitId: z.string().uuid("ID de unidad inválido").optional(),
  stage: z.enum([
    "NEW_LEAD", "CONTACTED", "DISCOVERY_DONE", "MEETING_SCHEDULED",
    "MEETING_COMPLETED", "PROPOSAL_SENT", "NEGOTIATION", "RESERVED",
    "CONTRACT_SIGNED", "CLOSING", "WON", "LOST", "FROZEN",
  ]).optional(),
  dealType: z.enum(["NATIVA_CONTADO", "NATIVA_FINANCIAMIENTO", "MACROLOTE", "CORRETAJE", "MASTERBROKER"]),
  estimatedValue: z.number().positive("El valor estimado debe ser positivo"),
  currency: z.enum(["MXN", "USD"]).optional(),
  probability: z.number().int().min(0).max(100).optional(),
  expectedCloseDate: z.coerce.date(),
  leadSourceAtDeal: z.string().min(1, "La fuente del lead es requerida"),
  assignedToId: z.string().uuid("ID de asesor inválido").optional(),
});

/**
 * GET /api/deals
 * Lista deals con paginación y filtros, restringidos por rol RBAC.
 * Director=todos, Gerente=plaza, TL=equipo, Asesor=propios.
 */
export async function GET(request: NextRequest) {
  try {
    // Verificar autenticación
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);

    // Parámetros de paginación
    const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
    const pageSize = Math.min(500, Math.max(1, parseInt(searchParams.get("pageSize") || "50")));
    const skip = (page - 1) * pageSize;

    // Parámetros de filtro
    const stage = searchParams.get("stage") || undefined;
    const dealType = searchParams.get("dealType") || undefined;
    const advisorId = searchParams.get("advisorId") || undefined;
    const developmentId = searchParams.get("developmentId") || undefined;
    const sortBy = searchParams.get("sortBy") || "createdAt";
    const sortOrder = (searchParams.get("sortOrder") || "desc") as "asc" | "desc";

    // Construir filtros RBAC
    const where: Prisma.DealWhereInput = {
      deletedAt: null,
    };

    const userRole = session.user.role;
    const userId = session.user.id;
    const userPlaza = session.user.plaza;

    if (OWN_ACCESS_ROLES.includes(userRole)) {
      // Asesores solo ven sus deals
      where.assignedToId = userId;
    } else if (TEAM_ACCESS_ROLES.includes(userRole)) {
      // Team leaders ven deals de su equipo
      const teamMembers = await prisma.user.findMany({
        where: { teamLeaderId: userId },
        select: { id: true },
      });
      const teamIds = [userId, ...teamMembers.map((m) => m.id)];
      where.assignedToId = { in: teamIds };
    } else if (PLAZA_ACCESS_ROLES.includes(userRole)) {
      // Gerente ve deals de su plaza
      where.assignedTo = { plaza: userPlaza as any };
    } else if (READ_ONLY_ROLES.includes(userRole)) {
      // Solo lectura, sin filtro adicional para developer ext
      if (userRole !== "DEVELOPER_EXT") {
        where.assignedToId = userId;
      }
    } else if (!FULL_ACCESS_ROLES.includes(userRole)) {
      return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
    }

    // Filtros específicos
    if (stage) where.stage = stage as any;
    if (dealType) where.dealType = dealType as any;
    if (advisorId) where.assignedToId = advisorId;
    if (developmentId) where.developmentId = developmentId;

    // Ejecutar consulta con relaciones
    const [deals, total] = await Promise.all([
      prisma.deal.findMany({
        where,
        include: {
          contact: { select: { id: true, firstName: true, lastName: true, phone: true, temperature: true } },
          assignedTo: { select: { id: true, name: true, email: true, avatarUrl: true } },
          development: { select: { id: true, name: true } },
          unit: { select: { id: true, unitNumber: true } },
          activities: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { createdAt: true },
          },
          _count: { select: { activities: true } },
        },
        orderBy: { [sortBy]: sortOrder },
        skip,
        take: pageSize,
      }),
      prisma.deal.count({ where }),
    ]);

    return NextResponse.json({
      data: deals,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (error) {
    console.error("Error al listar deals:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/deals
 * Crea un nuevo deal con validación y probabilidad inicial.
 */
export async function POST(request: NextRequest) {
  try {
    // Verificar autenticación
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    // Verificar permisos de creación
    const userRole = session.user.role;
    const canCreate = [
      ...FULL_ACCESS_ROLES,
      ...PLAZA_ACCESS_ROLES,
      ...TEAM_ACCESS_ROLES,
      ...OWN_ACCESS_ROLES,
    ].includes(userRole);

    if (!canCreate) {
      return NextResponse.json(
        { error: "No tienes permiso para crear deals" },
        { status: 403 }
      );
    }

    // Parsear y validar body
    const body = await request.json();
    const validation = createDealSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: "Datos inválidos", details: validation.error.flatten() },
        { status: 400 }
      );
    }

    const data = validation.data;

    // Verificar que el contacto existe
    const contact = await prisma.contact.findUnique({
      where: { id: data.contactId },
      select: { leadSource: true },
    });
    if (!contact) {
      return NextResponse.json(
        { error: "Contacto no encontrado" },
        { status: 404 }
      );
    }

    // Verificar que el desarrollo existe (si se proporcionó)
    if (data.developmentId) {
      const development = await prisma.development.findUnique({
        where: { id: data.developmentId },
      });
      if (!development) {
        return NextResponse.json(
          { error: "Desarrollo no encontrado" },
          { status: 404 }
        );
      }
    }

    // Verificar que la unidad existe y está disponible (si se proporcionó)
    if (data.unitId) {
      const unit = await prisma.unit.findUnique({
        where: { id: data.unitId },
      });
      if (!unit) {
        return NextResponse.json(
          { error: "Unidad no encontrada" },
          { status: 404 }
        );
      }
      if (unit.status !== "DISPONIBLE") {
        return NextResponse.json(
          { error: "La unidad no está disponible" },
          { status: 409 }
        );
      }
    }

    const assignedToId = data.assignedToId || session.user.id;
    const initialStage = data.stage || "NEW_LEAD";
    const probability = data.probability || DEAL_STAGE_PROBABILITY[initialStage] || 5;

    // Crear el deal
    const deal = await prisma.deal.create({
      data: {
        contactId: data.contactId,
        assignedToId,
        developmentId: data.developmentId || null,
        unitId: data.unitId || null,
        stage: initialStage as any,
        dealType: data.dealType,
        estimatedValue: data.estimatedValue,
        currency: data.currency || "MXN",
        probability,
        expectedCloseDate: data.expectedCloseDate,
        leadSourceAtDeal: data.leadSourceAtDeal,
      },
      include: {
        contact: { select: { id: true, firstName: true, lastName: true } },
        assignedTo: { select: { id: true, name: true } },
        development: { select: { id: true, name: true } },
        unit: { select: { id: true, unitNumber: true } },
      },
    });

    // Crear actividad de registro automática
    await prisma.activity.create({
      data: {
        contactId: data.contactId,
        dealId: deal.id,
        userId: session.user.id,
        activityType: "NOTE",
        subject: "Deal creado",
        description: `Nuevo deal tipo ${data.dealType} con valor estimado de ${data.estimatedValue}`,
        status: "COMPLETADA",
        completedAt: new Date(),
      },
    });

    return NextResponse.json({ data: deal }, { status: 201 });
  } catch (error) {
    console.error("Error al crear deal:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
