// ============================================================
// API Route: /api/users
// Consulta de usuarios del CRM
// GET - Listar usuarios filtrados por rol de acceso
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { Prisma } from "@prisma/client";

// Roles con acceso completo a todos los usuarios
const FULL_ACCESS_ROLES = ["DIRECTOR", "GERENTE", "DEVELOPER_EXT"];
// Roles con acceso a miembros de su equipo
const TEAM_ACCESS_ROLES = ["TEAM_LEADER"];

/**
 * GET /api/users
 * Lista usuarios del CRM. El acceso depende del rol:
 * - Director/Gerente/DevExt: ven todos los usuarios
 * - Team Leader: ve a los miembros de su equipo
 * - Asesores: solo se ven a sí mismos
 * - Otros roles: lista básica (id, nombre) para selectores
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
    const role = searchParams.get("role") || undefined;
    const plaza = searchParams.get("plaza") || undefined;
    const isActive = searchParams.get("isActive");
    const search = searchParams.get("search") || undefined;
    // Modo básico: solo devuelve id y nombre (para selectores/dropdowns)
    const basic = searchParams.get("basic") === "true";

    const userRole = session.user.role;
    const currentUserId = session.user.id;

    // Construir filtros
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
    };

    // Filtrar por acceso según rol
    if (FULL_ACCESS_ROLES.includes(userRole)) {
      // Acceso completo, sin filtro adicional
    } else if (TEAM_ACCESS_ROLES.includes(userRole)) {
      // Team leader ve a su equipo y a sí mismo
      where.OR = [
        { id: currentUserId },
        { teamLeaderId: currentUserId },
      ];
    } else if (["ASESOR_SR", "ASESOR_JR"].includes(userRole)) {
      // Asesores solo se ven a sí mismos en modo completo
      // En modo básico, pueden ver otros asesores de su equipo (para transferencias)
      if (basic) {
        const currentUser = await prisma.user.findUnique({
          where: { id: currentUserId },
          select: { teamLeaderId: true },
        });
        if (currentUser?.teamLeaderId) {
          where.OR = [
            { id: currentUserId },
            { teamLeaderId: currentUser.teamLeaderId },
          ];
        } else {
          where.id = currentUserId;
        }
      } else {
        where.id = currentUserId;
      }
    } else {
      // Hostess, Marketing: lista básica de asesores activos
      if (!basic) {
        where.id = currentUserId;
      } else {
        where.role = { in: ["ASESOR_SR", "ASESOR_JR", "TEAM_LEADER"] };
        where.isActive = true;
      }
    }

    // Filtros adicionales
    if (role) where.role = role as any;
    if (plaza) where.plaza = plaza as any;
    if (isActive !== null && isActive !== undefined) {
      where.isActive = isActive === "true";
    }
    if (search) {
      where.AND = [
        where.AND as any || {},
        {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { email: { contains: search, mode: "insensitive" } },
          ],
        },
      ];
    }

    // Seleccionar campos según modo
    if (basic) {
      // Modo básico: solo datos esenciales
      const users = await prisma.user.findMany({
        where,
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          plaza: true,
          isActive: true,
        },
        orderBy: { name: "asc" },
      });

      return NextResponse.json({ data: users });
    }

    // Modo completo: todos los datos (excepto passwordHash)
    const users = await prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        careerLevel: true,
        plaza: true,
        teamLeaderId: true,
        teamLeader: { select: { id: true, name: true } },
        sedetusNumber: true,
        sedetusExpiry: true,
        isActive: true,
        avatarUrl: true,
        phone: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            assignedContacts: true,
            deals: true,
            activities: true,
            teamMembers: true,
          },
        },
      },
      orderBy: { name: "asc" },
    });

    return NextResponse.json({ data: users });
  } catch (error) {
    console.error("Error al listar usuarios:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
