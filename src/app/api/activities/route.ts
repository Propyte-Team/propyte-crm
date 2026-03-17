// ============================================================
// API Route: /api/activities
// Gestión de actividades e interacciones
// GET  - Listar actividades con filtros
// POST - Crear nueva actividad
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { Prisma } from "@prisma/client";

// Roles con acceso completo a actividades
const FULL_ACCESS_ROLES = ["ADMIN", "DIRECTOR", "GERENTE", "DEVELOPER_EXT", "MANTENIMIENTO"];
// Roles con acceso a actividades de su equipo
const TEAM_ACCESS_ROLES = ["ADMIN", "TEAM_LEADER"];
// Roles con acceso solo a actividades propias
const OWN_ACCESS_ROLES = ["ASESOR", "ASESOR_SR", "ASESOR_JR", "BROKER", "HOSTESS"];

// Esquema de validación para crear actividad
const createActivitySchema = z.object({
  contactId: z.string().uuid("ID de contacto inválido"),
  dealId: z.string().uuid("ID de deal inválido").optional(),
  activityType: z.enum([
    "CALL_OUTBOUND", "CALL_INBOUND", "WHATSAPP_OUT", "WHATSAPP_IN",
    "EMAIL_SENT", "EMAIL_RECEIVED", "MEETING_VIRTUAL", "MEETING_PRESENTIAL",
    "MEETING_SHOWROOM", "DISCOVERY_CALL", "PROPOSAL_DELIVERY", "FOLLOW_UP",
    "WALK_IN", "NOTE", "TASK", "CONTRACT_REVIEW", "CLOSING_ACTIVITY",
  ]),
  subject: z.string().min(3, "El asunto debe tener al menos 3 caracteres").max(200).trim(),
  description: z.string().max(5000).optional(),
  dueDate: z.coerce.date().optional(),
  status: z.enum(["PENDIENTE", "COMPLETADA", "VENCIDA", "CANCELADA"]).optional(),
  outcome: z.string().max(1000).optional(),
  duration_minutes: z.number().int().min(0).max(480).optional(),
});

/**
 * GET /api/activities
 * Lista actividades con filtros por contacto, deal, usuario y fechas.
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
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") || "20")));
    const skip = (page - 1) * pageSize;

    // Parámetros de filtro
    const contactId = searchParams.get("contactId") || undefined;
    const dealId = searchParams.get("dealId") || undefined;
    const userId = searchParams.get("userId") || undefined;
    const activityType = searchParams.get("activityType") || undefined;
    const status = searchParams.get("status") || undefined;
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");
    const sortBy = searchParams.get("sortBy") || "createdAt";
    const sortOrder = (searchParams.get("sortOrder") || "desc") as "asc" | "desc";

    // Construir filtros
    const where: Prisma.ActivityWhereInput = {
      deletedAt: null,
    };

    // Filtrar por acceso según rol
    const userRole = session.user.role;
    const currentUserId = session.user.id;

    if (OWN_ACCESS_ROLES.includes(userRole)) {
      // Solo actividades del propio usuario
      where.userId = currentUserId;
    } else if (TEAM_ACCESS_ROLES.includes(userRole)) {
      // Actividades del equipo
      const teamMembers = await prisma.user.findMany({
        where: { teamLeaderId: currentUserId },
        select: { id: true },
      });
      const teamIds = [currentUserId, ...teamMembers.map((m) => m.id)];
      where.userId = { in: teamIds };
    } else if (!FULL_ACCESS_ROLES.includes(userRole)) {
      // Marketing puede ver actividades (lectura)
      if (userRole !== "MARKETING") {
        return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
      }
    }

    // Filtros específicos
    if (contactId) where.contactId = contactId;
    if (dealId) where.dealId = dealId;
    if (userId) where.userId = userId;
    if (activityType) where.activityType = activityType as any;
    if (status) where.status = status as any;

    // Filtro de rango de fechas
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) (where.createdAt as any).gte = new Date(dateFrom);
      if (dateTo) (where.createdAt as any).lte = new Date(dateTo);
    }

    // Ejecutar consulta
    const [activities, total] = await Promise.all([
      prisma.activity.findMany({
        where,
        include: {
          contact: { select: { id: true, firstName: true, lastName: true } },
          deal: { select: { id: true, stage: true, estimatedValue: true } },
          user: { select: { id: true, name: true } },
        },
        orderBy: { [sortBy]: sortOrder },
        skip,
        take: pageSize,
      }),
      prisma.activity.count({ where }),
    ]);

    return NextResponse.json({
      data: activities,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (error) {
    console.error("Error al listar actividades:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/activities
 * Crea una nueva actividad asociada a un contacto y opcionalmente a un deal.
 */
export async function POST(request: NextRequest) {
  try {
    // Verificar autenticación
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    // Verificar permisos de creación (Marketing no puede crear actividades)
    const userRole = session.user.role;
    const canCreate = [
      ...FULL_ACCESS_ROLES,
      ...TEAM_ACCESS_ROLES,
      ...OWN_ACCESS_ROLES,
    ].includes(userRole);

    if (!canCreate) {
      return NextResponse.json(
        { error: "No tienes permiso para crear actividades" },
        { status: 403 }
      );
    }

    // Parsear y validar body
    const body = await request.json();
    const validation = createActivitySchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: "Datos inválidos", details: validation.error.flatten() },
        { status: 400 }
      );
    }

    const data = validation.data;

    // Verificar que el contacto existe
    const contact = await prisma.contact.findUnique({
      where: { id: data.contactId, deletedAt: null },
    });
    if (!contact) {
      return NextResponse.json(
        { error: "Contacto no encontrado" },
        { status: 404 }
      );
    }

    // Verificar que el deal existe (si se proporcionó)
    if (data.dealId) {
      const deal = await prisma.deal.findUnique({
        where: { id: data.dealId, deletedAt: null },
      });
      if (!deal) {
        return NextResponse.json(
          { error: "Deal no encontrado" },
          { status: 404 }
        );
      }
    }

    // Crear la actividad (siempre asociada al usuario actual)
    const activity = await prisma.activity.create({
      data: {
        contactId: data.contactId,
        dealId: data.dealId || null,
        userId: session.user.id,
        activityType: data.activityType,
        subject: data.subject,
        description: data.description || null,
        dueDate: data.dueDate || null,
        status: data.status || "PENDIENTE",
        outcome: data.outcome || null,
        duration_minutes: data.duration_minutes || null,
        // Si el estado es COMPLETADA, registrar la fecha de completado
        completedAt: data.status === "COMPLETADA" ? new Date() : null,
      },
      include: {
        contact: { select: { id: true, firstName: true, lastName: true } },
        deal: { select: { id: true, stage: true } },
        user: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json({ data: activity }, { status: 201 });
  } catch (error) {
    console.error("Error al crear actividad:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
