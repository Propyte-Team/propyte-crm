// ============================================================
// API Route: /api/notifications
// Gestión de notificaciones in-app del usuario
// GET    - Listar notificaciones del usuario actual
// PATCH  - Marcar notificaciones como leídas
// DELETE - Eliminar notificaciones (#793: el panel las acumulaba para siempre)
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

// Mismo shape que markReadSchema, para DELETE: notificationIds puntuales o deleteAll
const deleteSchema = z.object({
  notificationIds: z.array(z.string().uuid()).optional(),
  deleteAll: z.boolean().optional(),
});

/**
 * GET /api/notifications
 * Lista las notificaciones del usuario actual.
 * Solo muestra notificaciones propias (cada usuario ve las suyas).
 */
export async function GET(request: NextRequest) {
  try {
    // Verificar autenticación.
    //
    // #770 (auditoría de PR): el PR #70 añadió `if (!session?.user?.id)` DESPUÉS de la
    // línea que ya usaba `session.user.id` para construir `where`. Un guardia colocado
    // después de la línea que protege no protege nada: si `session.user` llegara a existir
    // sin `id` -un JWT firmado antes de que el callback de sesión lo escribiera es la vía
    // real, no una hipotética; ver #714 S-05, las sesiones no se revalidan hasta 8 horas-,
    // `where.userId` quedaría en `undefined`. Prisma OMITE del `where` cualquier clave en
    // `undefined` -no es lo mismo que `null`-, así que la consulta de abajo dejaría de
    // filtrar por usuario y listaría las notificaciones de TODOS. La comprobación se funde
    // aquí con la de `session.user` para que no pueda existir una entre las dos líneas.
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);

    // Parámetros de filtro
    const unreadOnly = searchParams.get("unreadOnly") === "true";
    const type = searchParams.get("type") || undefined;
    // `pageSize` como alias de `limit`: lo añadió el PR #70 sin comentario. Se conserva
    // -no es lo que se está corrigiendo aquí- pero queda documentado por si alguien lo
    // busca: la pantalla puede mandar cualquiera de los dos nombres.
    const limitParam = searchParams.get("limit") || searchParams.get("pageSize") || "50";
    const limit = Math.min(100, Math.max(1, parseInt(limitParam)));

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
    // #794: guardia fusionado con el uso, igual que GET (ver el comentario largo de
    // #770 ahí arriba) — antes este guardia solo comprobaba `session.user`, no `.id`,
    // así que `session.user.id` podía llegar `undefined` al `where` de `updateMany` y
    // Prisma lo omitía del filtro: habría marcado como leídas notificaciones de
    // cualquier usuario, no solo las propias.
    const session = await getServerSession();
    if (!session?.user?.id) {
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

/**
 * DELETE /api/notifications
 * Elimina notificaciones del usuario actual (#793: el panel las acumulaba sin
 * límite una vez leídas, sin forma de limpiarlas).
 * Igual que PATCH: notificationIds puntuales o deleteAll, y siempre acotado al
 * propio usuario (guardia fusionado con el uso, ver #770/#794 arriba).
 */
export async function DELETE(request: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const validation = deleteSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: "Datos inválidos", details: validation.error.flatten() },
        { status: 400 }
      );
    }

    const { notificationIds, deleteAll } = validation.data;

    if (deleteAll) {
      const result = await prisma.notification.deleteMany({
        where: { userId: session.user.id },
      });

      return NextResponse.json({
        message: `${result.count} notificaciones eliminadas`,
        deletedCount: result.count,
      });
    }

    if (notificationIds && notificationIds.length > 0) {
      // Solo se pueden eliminar las del propio usuario
      const result = await prisma.notification.deleteMany({
        where: {
          id: { in: notificationIds },
          userId: session.user.id,
        },
      });

      return NextResponse.json({
        message: `${result.count} notificaciones eliminadas`,
        deletedCount: result.count,
      });
    }

    return NextResponse.json(
      { error: "Debes proporcionar notificationIds o deleteAll: true" },
      { status: 400 }
    );
  } catch (error) {
    console.error("Error al eliminar notificaciones:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
