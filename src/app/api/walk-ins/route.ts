// ============================================================
// API Route: /api/walk-ins
// Registro y consulta de visitas walk-in
// GET  - Listar walk-ins por fecha
// POST - Registrar un nuevo walk-in (hostess)
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { Prisma } from "@prisma/client";

// Roles que pueden ver todos los walk-ins
const FULL_ACCESS_ROLES = ["ADMIN", "DIRECTOR", "GERENTE", "DEVELOPER_EXT", "MANTENIMIENTO", "TEAM_LEADER"];
// Roles que pueden registrar walk-ins
const CAN_REGISTER_ROLES = ["ADMIN", "HOSTESS", "DIRECTOR", "GERENTE", "DEVELOPER_EXT", "MANTENIMIENTO"];

// Esquema de validación para registrar walk-in
const createWalkInSchema = z.object({
  contactId: z.string().uuid("ID de contacto inválido"),
  visitPurpose: z.enum(["INVERSION", "USO_PROPIO", "INFORMACION", "OTRO"]),
  assignedAdvisorId: z.string().uuid("ID de asesor inválido").optional(),
  notes: z.string().max(2000).optional(),
});

/**
 * GET /api/walk-ins
 * Lista walk-ins con filtro por fecha.
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
    const dateStr = searchParams.get("date");
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");
    const hostessId = searchParams.get("hostessId") || undefined;
    const advisorId = searchParams.get("advisorId") || undefined;

    const userRole = session.user.role;
    const currentUserId = session.user.id;

    // Construir filtros
    const where: Prisma.WalkInWhereInput = {
      deletedAt: null,
    };

    // Filtrar por acceso según rol
    if (userRole === "HOSTESS") {
      // Hostess solo ve sus propios walk-ins registrados
      where.hostessId = currentUserId;
    } else if (["ASESOR_SR", "ASESOR_JR"].includes(userRole)) {
      // Asesores ven walk-ins donde fueron asignados
      where.assignedAdvisorId = currentUserId;
    } else if (!FULL_ACCESS_ROLES.includes(userRole)) {
      return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
    }

    // Filtro de fecha específica
    if (dateStr) {
      const date = new Date(dateStr);
      const nextDay = new Date(date);
      nextDay.setDate(nextDay.getDate() + 1);
      where.arrivalTime = { gte: date, lt: nextDay };
    }

    // Filtro de rango de fechas
    if (dateFrom || dateTo) {
      where.arrivalTime = {};
      if (dateFrom) (where.arrivalTime as any).gte = new Date(dateFrom);
      if (dateTo) (where.arrivalTime as any).lte = new Date(dateTo);
    }

    // Filtros adicionales
    if (hostessId) where.hostessId = hostessId;
    if (advisorId) where.assignedAdvisorId = advisorId;

    // Ejecutar consulta
    const walkIns = await prisma.walkIn.findMany({
      where,
      include: {
        hostess: { select: { id: true, name: true } },
        contact: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
            leadSource: true,
          },
        },
        assignedAdvisor: { select: { id: true, name: true } },
      },
      orderBy: { arrivalTime: "desc" },
    });

    return NextResponse.json({ data: walkIns });
  } catch (error) {
    console.error("Error al listar walk-ins:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/walk-ins
 * Registra un nuevo walk-in. Principalmente usado por la hostess.
 */
export async function POST(request: NextRequest) {
  try {
    // Verificar autenticación
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    // Verificar permisos de registro
    if (!CAN_REGISTER_ROLES.includes(session.user.role)) {
      return NextResponse.json(
        { error: "Solo Hostess, Director o Gerente pueden registrar walk-ins" },
        { status: 403 }
      );
    }

    // Parsear y validar body
    const body = await request.json();
    const validation = createWalkInSchema.safeParse(body);

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

    // Verificar que el asesor asignado existe (si se proporcionó)
    if (data.assignedAdvisorId) {
      const advisor = await prisma.user.findUnique({
        where: { id: data.assignedAdvisorId, isActive: true },
      });
      if (!advisor) {
        return NextResponse.json(
          { error: "Asesor asignado no encontrado o inactivo" },
          { status: 404 }
        );
      }
    }

    // Crear el walk-in (la hostess actual es quien lo registra)
    const walkIn = await prisma.walkIn.create({
      data: {
        hostessId: session.user.id,
        contactId: data.contactId,
        visitPurpose: data.visitPurpose,
        assignedAdvisorId: data.assignedAdvisorId || null,
        notes: data.notes || null,
        arrivalTime: new Date(),
      },
      include: {
        hostess: { select: { id: true, name: true } },
        contact: { select: { id: true, firstName: true, lastName: true, phone: true } },
        assignedAdvisor: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json({ data: walkIn }, { status: 201 });
  } catch (error) {
    console.error("Error al registrar walk-in:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
