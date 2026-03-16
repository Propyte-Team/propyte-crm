// ============================================================
// Full Sync Pipeline — Orquesta todo el flujo:
// inventario.csv → CRM (Prisma) → propyte-web (properties.ts)
// Llamado desde el botón "Sincronizar" en /sync
// ============================================================

import prisma from "@/lib/db";
import { parseInventoryCSV } from "./parser/inventory-csv-parser";
import { mapToSchema } from "./mapper/schema-mapper";
import { uploadToCRM } from "./uploader/crm-uploader";
import { publishToWeb, extractTypologies } from "./uploader/web-publisher";
import type { ParseResult, ParsedImage } from "./types";
import path from "path";

// Clasificación de imágenes por nombre (sin dependencia de pdf-parse)
function classifyImageByName(fileName: string, folder: string): ParsedImage {
  const name = fileName.toLowerCase();
  const dir = folder.toLowerCase();
  let category: ParsedImage["category"] = "PHOTO";
  if (dir.includes("render") || name.includes("exterior")) category = "RENDER_EXTERIOR";
  else if (dir.includes("interior") || name.includes("recamara") || name.includes("estudio")) category = "RENDER_INTERIOR";
  else if (dir.includes("tipolog") || name.includes("plano")) category = "FLOOR_PLAN";
  else if (name.includes("gym") || name.includes("alberca") || name.includes("pool") || name.includes("cowork")) category = "AMENITY";
  return { sourceFileId: fileName, category, description: fileName.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ") };
}

const SYNC_LOCAL_BASE = path.resolve(process.cwd(), "sync-local");

export async function runFullSync(
  monitoredFolderId: string,
  triggeredBy: "CRON" | "WEBHOOK" | "MANUAL" = "MANUAL",
): Promise<string> {
  const folder = await prisma.monitoredFolder.findUniqueOrThrow({
    where: { id: monitoredFolderId },
  });

  const syncJob = await prisma.syncJob.create({
    data: { monitoredFolderId, triggeredBy, status: "PENDING" },
  });

  try {
    // ====== 1. LEER O GENERAR INVENTARIO ======
    await prisma.syncJob.update({ where: { id: syncJob.id }, data: { status: "PARSING" } });

    let { units, project, metadata } = await parseInventoryCSV(folder.folderName.trim());

    // Si no hay datos en inventario.csv, ejecutar el analista automáticamente
    if (units.length === 0) {
      console.log(`[SYNC] No hay datos en inventario.csv para "${folder.folderName}". Ejecutando analista...`);

      const { analyzeDrivePriceList } = await import("./parser/drive-price-list-analyzer");
      const driveUrl = folder.folderUrl || `https://drive.google.com/drive/folders/${folder.externalFolderId}`;

      const analysis = await analyzeDrivePriceList({
        projectName: folder.folderName.trim(),
        developerName: "Desarrollador", // Se actualiza después
        city: folder.plaza === "PDC" ? "Playa del Carmen" : folder.plaza === "MERIDA" ? "Mérida" : "Tulum",
        driveFolderUrl: driveUrl,
      });

      if (analysis.errors.length > 0) {
        for (const err of analysis.errors) {
          console.warn(`[ANALISTA] ${err}`);
        }
      }

      // Re-leer inventario.csv con los datos recién generados
      const reread = await parseInventoryCSV(folder.folderName.trim());
      units = reread.units;
      project = reread.project;
      metadata = reread.metadata;

      if (units.length === 0) {
        console.warn(`[SYNC] Analista no pudo extraer unidades para "${folder.folderName}". Continuando con metadata solamente.`);
      } else {
        console.log(`[SYNC] Analista completado: ${units.length} unidades extraídas`);
      }
    }

    // ====== 2. OBTENER IMÁGENES ======
    const images: ParsedImage[] = [];
    let driveImageUrls: string[] = [];
    const localImagePath = path.join(SYNC_LOCAL_BASE, slugify(folder.folderName.trim()));

    // 2a. Buscar imágenes locales primero
    try {
      const fs = await import("fs/promises");
      const imgFiles = await listImagesRecursive(localImagePath, fs);
      for (const filePath of imgFiles) {
        const fileName = path.basename(filePath);
        const parentFolder = path.basename(path.dirname(filePath));
        images.push(classifyImageByName(fileName, parentFolder));
      }
      await prisma.syncJob.update({
        where: { id: syncJob.id },
        data: { filesDiscovered: imgFiles.length, filesNew: imgFiles.length },
      });
    } catch {
      // No hay imágenes locales
    }

    // 2b. Si no hay locales, buscar en Drive (urls_imagenes del proyecto + carpeta principal)
    if (images.length === 0 && project) {
      try {
        const { getDriveImageUrls } = await import("./crawler/drive-image-urls");
        const folderUrls: string[] = [];

        // Agregar URLs de imágenes extra del proyecto
        if (project.urls_imagenes) {
          folderUrls.push(...project.urls_imagenes.split("|").filter(Boolean));
        }
        // También buscar en la carpeta principal (puede tener subcarpetas con imágenes)
        if (project.url_carpeta_drive) {
          folderUrls.push(project.url_carpeta_drive);
        }

        driveImageUrls = await getDriveImageUrls(folderUrls);
        console.log(`[IMAGES] ${driveImageUrls.length} imágenes encontradas en Drive`);
      } catch (e) {
        console.error("[IMAGES] Error buscando imágenes en Drive:", (e as Error).message);
      }
    }

    // ====== 3. MAP ======
    await prisma.syncJob.update({ where: { id: syncJob.id }, data: { status: "MAPPING" } });

    const devName = project?.nombre_proyecto || folder.folderName.trim();
    const devCity = project?.ciudad || (folder.plaza === "PDC" ? "Playa del Carmen" : folder.plaza === "MERIDA" ? "Mérida" : folder.plaza === "CANCUN" ? "Cancún" : "Tulum");

    const parseResult: ParseResult = {
      folderId: folder.id,
      development: {
        name: devName,
        developerName: project?.desarrolladora || "Desarrollador",
        location: `${devCity}, Quintana Roo`,
        description: "Desarrollo inmobiliario en la Riviera Maya.",
        amenities: [],
        status: "CONSTRUCCION",
        commissionRate: 5.0,
        brochureUrl: project?.url_carpeta_drive,
      },
      units,
      images,
      warnings: [],
      confidence: units.length > 0 ? 1.0 : 0.5,
      parsedAt: new Date(),
    };

    // Limpiar unidades anteriores (solo si tenemos nuevas)
    const existingDev = await prisma.development.findFirst({
      where: { name: { contains: folder.folderName.trim(), mode: "insensitive" }, deletedAt: null },
    });

    if (existingDev && units.length > 0) {
      await prisma.unit.deleteMany({ where: { developmentId: existingDev.id } });
    }

    const mapResult = await mapToSchema(parseResult, {
      id: folder.id,
      plaza: folder.plaza as "PDC" | "TULUM" | "MERIDA",
      developmentType: folder.developmentType as "PROPIO" | "MASTERBROKER" | "CORRETAJE",
      developmentId: existingDev?.id || folder.developmentId,
    });

    if (metadata.totalReal) {
      mapResult.development.totalUnits = metadata.totalReal as number;
    }

    // ====== 4. UPLOAD AL CRM ======
    await prisma.syncJob.update({ where: { id: syncJob.id }, data: { status: "UPLOADING" } });

    const uploadResult = await uploadToCRM(mapResult);

    // Actualizar desarrollo con datos del proyecto
    if (project) {
      await prisma.development.update({
        where: { id: uploadResult.developmentId },
        data: {
          brochureUrl: project.url_carpeta_drive || undefined,
          developerName: project.desarrolladora || undefined,
          totalUnits: (metadata.totalReal as number) || undefined,
          soldUnits: (metadata.vendidas as number) || undefined,
        },
      });
    }

    // ====== 5. PUBLICAR EN PROPYTE-WEB (Supabase) ======
    const typologies = extractTypologies(
      units.filter((u) => u.status !== "VENDIDA").map((u) => ({
        unitType: u.unitType || "",
        area_m2: u.area_m2 || 0,
        price: u.price || 0,
        status: u.status || "DISPONIBLE",
        bedrooms: u.bedrooms,
        extras: u.extras,
      }))
    );

    const disponibles = units.filter((u) => u.status === "DISPONIBLE").length;
    const totalReal = (metadata.totalReal as number) || units.length || 0;
    const vendidas = (metadata.vendidas as number) || 0;

    const webResult = await publishToWeb({
      developmentName: devName,
      developerName: project?.desarrolladora || "Desarrollador",
      location: `${devCity}, Quintana Roo`,
      city: devCity,
      description_es: `Desarrollo inmobiliario en ${devCity}. ${totalReal > 0 ? `${totalReal} unidades totales.` : ""}`,
      description_en: `Real estate development in ${devCity}. ${totalReal > 0 ? `${totalReal} total units.` : ""}`,
      amenities: ["Alberca", "Gym", "Coworking", "Rooftop"],
      status: mapResult.development.status,
      constructionProgress: mapResult.development.constructionProgress,
      deliveryYear: "2027",
      totalUnits: totalReal,
      availableUnits: disponibles,
      absorption: totalReal > 0 ? Math.round((vendidas / totalReal) * 100) : 0,
      driveUrl: project?.url_carpeta_drive,
      typologies,
      imageFolder: localImagePath,
      driveImageUrls,
      commissionRate: mapResult.development.commissionRate,
      zone: undefined,
    });

    // Deploy se maneja en la cola (sync-queue.ts) — 1 deploy al final de todos los syncs

    // ====== FINALIZAR ======
    await prisma.syncJob.update({
      where: { id: syncJob.id },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        developmentId: uploadResult.developmentId,
        unitsCreated: uploadResult.unitsCreated,
        unitsUpdated: uploadResult.unitsUpdated,
        imagesProcessed: images.length,
        uploadData: {
          crm: uploadResult,
          web: { published: webResult.published, updated: webResult.updated, urls: webResult.urls },
        } as any,
      },
    });

    await prisma.monitoredFolder.update({
      where: { id: folder.id },
      data: { lastSyncAt: new Date(), lastSyncStatus: "COMPLETED", developmentId: uploadResult.developmentId },
    });

    return syncJob.id;
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Error desconocido";
    await prisma.syncJob.update({
      where: { id: syncJob.id },
      data: { status: "FAILED", error: msg, completedAt: new Date() },
    });
    await prisma.monitoredFolder.update({
      where: { id: folder.id },
      data: { lastSyncAt: new Date(), lastSyncStatus: "FAILED" },
    });
    throw error;
  }
}

async function listImagesRecursive(dirPath: string, fs: typeof import("fs/promises")): Promise<string[]> {
  const results: string[] = [];
  const exts = new Set([".jpg", ".jpeg", ".png", ".webp"]);
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        results.push(...await listImagesRecursive(full, fs));
      } else if (exts.has(path.extname(entry.name).toLowerCase())) {
        results.push(full);
      }
    }
  } catch { /* dir doesn't exist */ }
  return results;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
