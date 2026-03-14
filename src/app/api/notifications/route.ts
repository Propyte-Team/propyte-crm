// ============================================================
// API Route: /api/notifications
// Gestión de notificaciones in-app del usuario
// GET   - Listar notificaciones del usuario actual
// PATCH - Marcar notificaciones como leídas
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";

// Esquema de validación para marcar como leídas
const markReadSchema = z.object({
  // IDs de notificaciones a marcar como leídas (si vacío, marca todas)
  notificationIds: z.array(z.string().uuid()).optional(),
  // Marcar todas las notificaciones como leídas
  markAll: z.boolean().optional(),
});

/**
 * GET /api/notifications
 * Lista las notificaciones del usuario actual.
 * Solo muestra notificaciones propias (cada usuario ve las suyas).
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
    const unreadOnly = searchParams.get("unreadOnly") === "true";
    const type = searchParams.get("type") || undefined;
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "50")));

    // Construir filtros (siempre del usuario actual)
    const where: any = {
      userId: session.user.id,
    };

    if (unreadOnly) {
      where.isRead = false;
    }
    if (type) {
      where.type = type;
    }

    // Ejecutar consulta
    const [notifications, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
      }),
      // Siempre devolver el conteo de no leídas para el badge
      prisma.notification.count({
        where: { userId: session.user.id, isRead: false },
      }),
    ]);

    return NextResponse.json({
      data: notifications,
      unreadCount,
    });
  } catch (error) {
    console.error("Error al listar notificaciones:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/notifications
 * Marca notificaciones como leídas.
 * Se pueden marcar notificaciones específicas o todas.
 */
export async function PATCH(request: NextRequest) {
  try {
    // Verificar autenticación
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    // Parsear y validar body
    const body = await request.json();
    const validation = markReadSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: "Datos inválidos", details: validation.error.flatten() },
        { status: 400 }
      );
    }

    const { notificationIds, markAll } = validation.data;

    if (markAll) {
      // Marcar todas las notificaciones del usuario como leídas
      const result = await prisma.notification.updateMany({
        where: {
          userId: session.user.id,
          isRead: false,
        },
        data: { isRead: true },
      });

      return NextResponse.json({
        message: `${result.count} notificaciones marcadas como leídas`,
        updatedCount: result.count,
      });
    }

    if (notificationIds && notificationIds.length > 0) {
      // Marcar notificaciones específicas como leídas
      // Solo se pueden marcar las del propio usuario
      const result = await prisma.notification.updateMany({
        where: {
          id: { in: notificationIds },
          userId: session.user.id,
          isRead: false,
        },
        data: { isRead: true },
      });

      return NextResponse.json({
        message: `${result.count} notificaciones marcadas como leídas`,
        updatedCount: result.count,
      });
    }

    return NextResponse.json(
      { error: "Debes proporcionar notificationIds o markAll: true" },
      { status: 400 }
    );
  } catch (error) {
    console.error("Error al marcar notificaciones:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
