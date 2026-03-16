// ============================================================
// API Route: /api/sync/jobs
// Ejecutar y consultar jobs de sincronización
// GET  - Listar jobs con filtros
// POST - Disparar un nuevo sync job
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
const ADMIN_ROLES = ["DIRECTOR", "GERENTE", "DEVELOPER_EXT"];

const triggerSyncSchema = z.object({
  monitoredFolderId: z.string().uuid("ID de carpeta inválido"),
});

/**
 * GET /api/sync/jobs
 * Lista sync jobs con filtros.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const folderId = searchParams.get("folderId");
    const status = searchParams.get("status");
    const limit = Math.min(parseInt(searchParams.get("limit") || "20", 10), 100);

    const where: Record<string, unknown> = {};
    if (folderId) where.monitoredFolderId = folderId;
    if (status) where.status = status;

    const jobs = await prisma.syncJob.findMany({
      where,
      include: {
        monitoredFolder: {
          select: { folderName: true, provider: true },
        },
        _count: { select: { logs: true } },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return NextResponse.json({ data: jobs });
  } catch (error) {
    console.error("Error al listar sync jobs:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

/**
 * POST /api/sync/jobs
 * Dispara un nuevo sync job manualmente.
 * El pipeline se ejecuta de forma asíncrona.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    if (!ADMIN_ROLES.includes(session.user.role)) {
      return NextResponse.json(
        { error: "Solo Director, Gerente o Developer pueden disparar syncs" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const validation = triggerSyncSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: "Datos inválidos", details: validation.error.flatten() },
        { status: 400 }
      );
    }

    const { monitoredFolderId } = validation.data;

    // Verificar que la carpeta existe y está activa
    const folder = await prisma.monitoredFolder.findUnique({
      where: { id: monitoredFolderId },
    });

    if (!folder) {
      return NextResponse.json({ error: "Carpeta no encontrada" }, { status: 404 });
    }

    if (!folder.isActive) {
      return NextResponse.json({ error: "Esta carpeta está desactivada" }, { status: 400 });
    }

    // Verificar que no hay un job en progreso para esta carpeta
    const activeJob = await prisma.syncJob.findFirst({
      where: {
        monitoredFolderId,
        status: { in: ["PENDING", "CRAWLING", "PARSING", "MAPPING", "UPLOADING"] },
      },
    });

    if (activeJob) {
      return NextResponse.json(
        {
          error: "Ya hay un sync en progreso para esta carpeta",
          activeJobId: activeJob.id,
          status: activeJob.status,
        },
        { status: 409 }
      );
    }

    // Importar dinámicamente para evitar que pdf-parse/xlsx rompan webpack
    const { runFullSync } = await import("@/lib/agents/run-full-sync");
    const jobPromise = runFullSync(monitoredFolderId, "MANUAL");

    // No esperamos a que termine — retornamos inmediato
    jobPromise.catch((error) => {
      console.error(`Sync pipeline failed for folder ${monitoredFolderId}:`, error);
    });

    // Dar un pequeño delay para que se cree el job en DB
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Obtener el job recién creado
    const job = await prisma.syncJob.findFirst({
      where: { monitoredFolderId },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(
      {
        data: job,
        message: "Sync iniciado. Consulta el estado en GET /api/sync/jobs?folderId=...",
      },
      { status: 202 }
    );
  } catch (error) {
    console.error("Error al disparar sync:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
