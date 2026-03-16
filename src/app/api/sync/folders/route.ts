// ============================================================
// API Route: /api/sync/folders
// Gestión de carpetas monitoreadas (Drive/Dropbox)
// GET  - Listar carpetas con su estado de sync
// POST - Registrar nueva carpeta para monitoreo
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
const ADMIN_ROLES = ["DIRECTOR", "GERENTE", "DEVELOPER_EXT"];

const createFolderSchema = z.object({
  provider: z.enum(["GOOGLE_DRIVE", "DROPBOX"]).default("GOOGLE_DRIVE"),
  externalFolderId: z.string().min(1, "El ID de la carpeta es requerido"),
  folderName: z.string().min(1, "El nombre de la carpeta es requerido"),
  folderUrl: z.string().optional(),
  plaza: z.enum(["PDC", "TULUM", "MERIDA"]),
  developmentType: z.enum(["PROPIO", "MASTERBROKER", "CORRETAJE"]),
  developmentId: z.string().uuid().optional(),
  syncInterval: z.number().int().min(5).max(1440).optional(),
  // Campos opcionales para modo manual
  developerName: z.string().optional(),
  totalUnits: z.string().optional(),
  urlImagenes: z.string().optional(),
  urlRenders: z.string().optional(),
  urlListaPrecios: z.string().optional(),
  urlBrochure: z.string().optional(),
});

/**
 * GET /api/sync/folders
 * Lista todas las carpetas monitoreadas con su último estado de sync.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const folders = await prisma.monitoredFolder.findMany({
      include: {
        development: { select: { id: true, name: true, status: true } },
        _count: { select: { syncJobs: true, syncFiles: true } },
        syncJobs: {
          take: 1,
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            status: true,
            filesDiscovered: true,
            filesNew: true,
            unitsCreated: true,
            unitsUpdated: true,
            error: true,
            startedAt: true,
            completedAt: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ data: folders });
  } catch (error) {
    console.error("Error al listar carpetas:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

/**
 * POST /api/sync/folders
 * Registra una nueva carpeta para monitoreo.
 * Verifica acceso a la carpeta antes de registrar.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    if (!ADMIN_ROLES.includes(session.user.role)) {
      return NextResponse.json(
        { error: "Solo Director, Gerente o Developer pueden registrar carpetas" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const validation = createFolderSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: "Datos inválidos", details: validation.error.flatten() },
        { status: 400 }
      );
    }

    const data = validation.data;

    // Verificar que la carpeta no esté ya registrada
    const existing = await prisma.monitoredFolder.findUnique({
      where: {
        provider_externalFolderId: {
          provider: data.provider,
          externalFolderId: data.externalFolderId,
        },
      },
    });

    if (existing) {
      return NextResponse.json(
        { error: "Esta carpeta ya está registrada para monitoreo" },
        { status: 409 }
      );
    }

    // Extraer el ID de la carpeta si el usuario pegó la URL completa
    if (data.externalFolderId.includes("drive.google.com") || data.externalFolderId.includes("folders/")) {
      const match = data.externalFolderId.match(/folders\/([a-zA-Z0-9_-]+)/);
      if (match) {
        data.externalFolderId = match[1];
      }
    }
    // Limpiar query params (?usp=drive_link, etc.)
    data.externalFolderId = data.externalFolderId.split("?")[0];

    const folder = await prisma.monitoredFolder.create({
      data: {
        provider: data.provider || "GOOGLE_DRIVE",
        externalFolderId: data.externalFolderId,
        folderName: data.folderName,
        folderUrl: data.folderUrl,
        plaza: data.plaza,
        developmentType: data.developmentType,
        developmentId: data.developmentId,
        syncInterval: data.syncInterval || 15,
      },
    });

    // Actualizar proyectos.csv con la info adicional
    try {
      const fs = await import("fs/promises");
      const path = await import("path");
      const projectsCsv = path.resolve(process.cwd(), "../proyectos.csv");

      let content = "";
      try { content = await fs.readFile(projectsCsv, "utf-8"); } catch { content = "nombre_proyecto,desarrolladora,ciudad,url_carpeta_drive,notas,total_unidades,inicio_ventas,urls_imagenes\n"; }

      if (!content.toLowerCase().includes(data.folderName.toLowerCase())) {
        const city = data.plaza === "PDC" ? "Playa del Carmen" : data.plaza === "MERIDA" ? "Mérida" : "Tulum";
        const driveUrl = data.folderUrl || `https://drive.google.com/drive/folders/${data.externalFolderId}`;

        // Construir urls_imagenes desde campos manuales
        const imageUrls = [data.urlImagenes, data.urlRenders, data.urlListaPrecios ? undefined : driveUrl]
          .filter(Boolean)
          .join("|");

        const line = `${data.folderName},${data.developerName || ""},${city},${driveUrl},,${data.totalUnits || ""},,${imageUrls}\n`;
        await fs.appendFile(projectsCsv, line);
      }
    } catch (e) {
      console.error("Error updating proyectos.csv:", e);
    }

    return NextResponse.json({ data: folder }, { status: 201 });
  } catch (error) {
    console.error("Error al registrar carpeta:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
