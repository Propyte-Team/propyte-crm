// ============================================================
// API Route: /api/sync/queue
// GET  - Estado de la cola de sync
// POST - Importar múltiples desarrollos desde CSV/JSON (bulk)
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";

const ADMIN_ROLES = ["DIRECTOR", "GERENTE", "DEVELOPER_EXT"];

/**
 * GET /api/sync/queue
 * Estado actual de la cola de sync.
 */
export async function GET() {
  try {
    const { syncQueue } = await import("@/lib/agents/sync-queue");
    return NextResponse.json({ data: syncQueue.getStatus() });
  } catch (error) {
    return NextResponse.json({ error: "Error obteniendo estado de cola" }, { status: 500 });
  }
}

/**
 * POST /api/sync/queue
 * Importación masiva de desarrollos desde CSV/JSON.
 *
 * Body: { developments: [{ name, driveUrl, plaza, type, developer, totalUnits }] }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user || !ADMIN_ROLES.includes(session.user.role)) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    const body = await request.json();
    const developments = body.developments as Array<{
      name: string;
      driveUrl: string;
      plaza?: string;
      type?: string;
      developer?: string;
      totalUnits?: number;
      urlImagenes?: string;
    }>;

    if (!developments || !Array.isArray(developments) || developments.length === 0) {
      return NextResponse.json(
        { error: "Se requiere un array 'developments' con al menos 1 elemento" },
        { status: 400 }
      );
    }

    const results: Array<{ name: string; status: "created" | "exists" | "error"; folderId?: string; error?: string }> = [];
    const folderIds: string[] = [];

    for (const dev of developments) {
      if (!dev.name || !dev.driveUrl) {
        results.push({ name: dev.name || "?", status: "error", error: "Falta name o driveUrl" });
        continue;
      }

      // Extraer folder ID del URL
      let folderId = dev.driveUrl;
      const match = dev.driveUrl.match(/folders\/([a-zA-Z0-9_-]+)/);
      if (match) folderId = match[1];
      folderId = folderId.split("?")[0];

      try {
        // Verificar si ya existe
        const existing = await prisma.monitoredFolder.findUnique({
          where: { provider_externalFolderId: { provider: "GOOGLE_DRIVE", externalFolderId: folderId } },
        });

        if (existing) {
          results.push({ name: dev.name, status: "exists", folderId: existing.id });
          folderIds.push(existing.id);
          continue;
        }

        // Crear
        const folder = await prisma.monitoredFolder.create({
          data: {
            provider: "GOOGLE_DRIVE",
            externalFolderId: folderId,
            folderName: dev.name,
            folderUrl: dev.driveUrl.split("?")[0],
            plaza: (dev.plaza?.toUpperCase() === "PDC" || dev.plaza?.toUpperCase() === "TULUM" || dev.plaza?.toUpperCase() === "MERIDA")
              ? dev.plaza.toUpperCase() as "PDC" | "TULUM" | "MERIDA"
              : "TULUM",
            developmentType: (dev.type?.toUpperCase() === "PROPIO" || dev.type?.toUpperCase() === "MASTERBROKER" || dev.type?.toUpperCase() === "CORRETAJE")
              ? dev.type.toUpperCase() as "PROPIO" | "MASTERBROKER" | "CORRETAJE"
              : "CORRETAJE",
            syncInterval: 60,
          },
        });

        // Actualizar proyectos.csv
        try {
          const fs = await import("fs/promises");
          const path = await import("path");
          const csvPath = path.resolve(process.cwd(), "../proyectos.csv");
          let content = "";
          try { content = await fs.readFile(csvPath, "utf-8"); } catch { content = "nombre_proyecto,desarrolladora,ciudad,url_carpeta_drive,notas,total_unidades,inicio_ventas,urls_imagenes\n"; }

          if (!content.toLowerCase().includes(dev.name.toLowerCase())) {
            const city = dev.plaza?.toUpperCase() === "PDC" ? "Playa del Carmen" : dev.plaza?.toUpperCase() === "MERIDA" ? "Mérida" : "Tulum";
            const line = `${dev.name},${dev.developer || ""},${city},${dev.driveUrl.split("?")[0]},,${dev.totalUnits || ""},,${dev.urlImagenes || dev.driveUrl.split("?")[0]}\n`;
            await fs.appendFile(csvPath, line);
          }
        } catch { /* ok */ }

        results.push({ name: dev.name, status: "created", folderId: folder.id });
        folderIds.push(folder.id);
      } catch (e) {
        results.push({ name: dev.name, status: "error", error: (e as Error).message });
      }
    }

    // Encolar todos los syncs
    if (folderIds.length > 0 && body.autoSync !== false) {
      const { syncQueue } = await import("@/lib/agents/sync-queue");
      syncQueue.enqueueBulk(folderIds.map((id) => ({ folderId: id })));
    }

    return NextResponse.json({
      data: {
        total: developments.length,
        created: results.filter((r) => r.status === "created").length,
        existing: results.filter((r) => r.status === "exists").length,
        errors: results.filter((r) => r.status === "error").length,
        queued: folderIds.length,
        results,
      },
    }, { status: 201 });
  } catch (error) {
    console.error("Error en bulk import:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
