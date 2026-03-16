// ============================================================
// API Route: /api/sync/cron
// Endpoint para cron job — sincroniza todas las carpetas activas
// Diseñado para ser llamado por Vercel Cron o un cron externo
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
// runSyncPipeline se importa dinámicamente para evitar problemas de webpack con pdf-parse

/**
 * GET /api/sync/cron
 * Ejecuta sync para todas las carpetas activas que lo necesiten.
 * Protegido por CRON_SECRET en header Authorization.
 */
export async function GET(request: NextRequest) {
  // Verificar secret del cron
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    // Obtener carpetas activas que necesitan sync
    const now = new Date();
    const folders = await prisma.monitoredFolder.findMany({
      where: {
        isActive: true,
        OR: [
          { lastSyncAt: null },
          // lastSyncAt + syncInterval minutos < ahora
          // Prisma no soporta esto directamente, lo filtramos en JS
        ],
      },
    });

    const foldersToSync = folders.filter((f) => {
      if (!f.lastSyncAt) return true;
      const nextSync = new Date(f.lastSyncAt.getTime() + f.syncInterval * 60 * 1000);
      return nextSync <= now;
    });

    if (foldersToSync.length === 0) {
      return NextResponse.json({
        message: "No hay carpetas pendientes de sincronización",
        totalActive: folders.length,
        synced: 0,
      });
    }

    // Ejecutar syncs en paralelo (con límite de concurrencia)
    const MAX_CONCURRENT = 3;
    const results: Array<{ folderId: string; folderName: string; status: string; jobId?: string; error?: string }> = [];

    for (let i = 0; i < foldersToSync.length; i += MAX_CONCURRENT) {
      const batch = foldersToSync.slice(i, i + MAX_CONCURRENT);
      const batchResults = await Promise.allSettled(
        batch.map(async (folder) => {
          const { runSyncPipeline } = await import("@/lib/agents");
          const jobId = await runSyncPipeline(folder.id, "CRON");
          return { folderId: folder.id, folderName: folder.folderName, status: "started", jobId };
        })
      );

      for (const result of batchResults) {
        if (result.status === "fulfilled") {
          results.push(result.value);
        } else {
          results.push({
            folderId: "unknown",
            folderName: "unknown",
            status: "failed",
            error: result.reason?.message || "Unknown error",
          });
        }
      }
    }

    return NextResponse.json({
      message: `Sincronización iniciada para ${results.length} carpetas`,
      totalActive: folders.length,
      synced: results.length,
      results,
    });
  } catch (error) {
    console.error("Error en cron de sync:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
