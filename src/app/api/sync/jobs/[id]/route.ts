// ============================================================
// API Route: /api/sync/jobs/[id]
// Detalle de un sync job con logs
// GET - Obtener job con logs completos
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";

/**
 * GET /api/sync/jobs/[id]
 * Obtiene el detalle completo de un sync job incluyendo logs.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id } = await params;

    const job = await prisma.syncJob.findUnique({
      where: { id },
      include: {
        monitoredFolder: {
          select: {
            folderName: true,
            provider: true,
            externalFolderId: true,
            folderUrl: true,
          },
        },
        logs: {
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!job) {
      return NextResponse.json({ error: "Job no encontrado" }, { status: 404 });
    }

    return NextResponse.json({ data: job });
  } catch (error) {
    console.error("Error al obtener sync job:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
