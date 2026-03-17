// ============================================================
// Agent Orchestrator — Pipeline principal de sincronización
// Drive/Dropbox → Parse → Map → Upload al CRM
// ============================================================

import prisma from "@/lib/db";
import { DriveCrawler } from "./crawler/drive-crawler";
import { DropboxCrawler } from "./crawler/dropbox-crawler";
import { parsePriceListPdf, parseBrochure, classifyImage } from "./parser/pdf-parser";
import { parseExcelPriceList } from "./parser/excel-parser";
import { mapToSchema } from "./mapper/schema-mapper";
import { uploadToCRM } from "./uploader/crm-uploader";
import { SyncLogger } from "./monitor/sync-logger";
import { SPREADSHEET_EXTENSIONS } from "./config";
import type {
  CrawlResult,
  CrawledFile,
  ParseResult,
  ParsedUnit,
  ParsedDevelopment,
  ParsedImage,
  SyncStatus,
} from "./types";
import path from "path";

/**
 * Ejecuta el pipeline completo de sincronización para una carpeta.
 * Crawl → Parse → Map → Upload
 */
export async function runSyncPipeline(
  monitoredFolderId: string,
  triggeredBy: "CRON" | "WEBHOOK" | "MANUAL" = "MANUAL",
) {
  // 1. Crear el SyncJob
  const syncJob = await prisma.syncJob.create({
    data: {
      monitoredFolderId,
      triggeredBy,
      status: "PENDING",
    },
  });

  const logger = new SyncLogger(syncJob.id);
  const folder = await prisma.monitoredFolder.findUniqueOrThrow({
    where: { id: monitoredFolderId },
  });

  try {
    // ====== STEP 1: CRAWL ======
    await updateJobStatus(syncJob.id, "CRAWLING");
    await logger.info("CRAWL", `Iniciando crawl de carpeta: ${folder.folderName}`);

    let crawlResult: CrawlResult;

    if (folder.provider === "GOOGLE_DRIVE") {
      const crawler = new DriveCrawler();
      crawlResult = await crawler.crawlFolder(monitoredFolderId);
    } else {
      const crawler = new DropboxCrawler();
      crawlResult = await crawler.crawlFolder(monitoredFolderId);
    }

    await prisma.syncJob.update({
      where: { id: syncJob.id },
      data: {
        filesDiscovered: crawlResult.totalFiles,
        filesNew: crawlResult.newFiles,
        filesModified: crawlResult.modifiedFiles,
        crawlData: crawlResult as any,
      },
    });

    await logger.info("CRAWL", `Crawl completado`, {
      totalFiles: crawlResult.totalFiles,
      newFiles: crawlResult.newFiles,
      modifiedFiles: crawlResult.modifiedFiles,
    });

    // Si no hay archivos nuevos/modificados, terminar
    if (crawlResult.files.length === 0) {
      await logger.info("ORCHESTRATOR", "No hay archivos nuevos o modificados. Sync completado sin cambios.");
      await finishJob(syncJob.id, "COMPLETED", folder.id);
      return syncJob.id;
    }

    // ====== STEP 2: PARSE ======
    await updateJobStatus(syncJob.id, "PARSING");
    await logger.info("PARSE", `Parseando ${crawlResult.files.length} archivos`);

    const parseResult = await parseFiles(crawlResult, folder.provider, logger);

    await prisma.syncJob.update({
      where: { id: syncJob.id },
      data: { parseData: parseResult as any },
    });

    await logger.info("PARSE", `Parse completado`, {
      unitsFound: parseResult.units.length,
      warnings: parseResult.warnings.length,
      confidence: parseResult.confidence,
    });

    if (parseResult.warnings.length > 0) {
      for (const warning of parseResult.warnings) {
        await logger.warn("PARSE", warning);
      }
    }

    // ====== STEP 3: MAP ======
    await updateJobStatus(syncJob.id, "MAPPING");
    await logger.info("MAP", "Mapeando datos al schema del CRM");

    const mapResult = await mapToSchema(parseResult, {
      id: folder.id,
      plaza: folder.plaza,
      developmentType: folder.developmentType,
      developmentId: folder.developmentId,
    });

    await prisma.syncJob.update({
      where: { id: syncJob.id },
      data: { mapData: mapResult as any },
    });

    await logger.info("MAP", `Mapeo completado`, {
      isUpdate: mapResult.isUpdate,
      totalUnits: mapResult.units.length,
      development: mapResult.development.name,
    });

    if (mapResult.changes?.alerts) {
      for (const alert of mapResult.changes.alerts) {
        await logger.warn("MAP", `ALERTA: ${alert}`);
      }
    }

    // ====== STEP 4: UPLOAD ======
    await updateJobStatus(syncJob.id, "UPLOADING");
    await logger.info("UPLOAD", `Subiendo datos al CRM (${mapResult.isUpdate ? "UPDATE" : "CREATE"})`);

    const uploadResult = await uploadToCRM(mapResult);

    await prisma.syncJob.update({
      where: { id: syncJob.id },
      data: {
        developmentId: uploadResult.developmentId,
        unitsCreated: uploadResult.unitsCreated,
        unitsUpdated: uploadResult.unitsUpdated,
        imagesProcessed: uploadResult.imagesUploaded,
        uploadData: uploadResult as any,
      },
    });

    if (uploadResult.errors.length > 0) {
      for (const err of uploadResult.errors) {
        await logger.error("UPLOAD", err);
      }
    }

    await logger.info("UPLOAD", `Upload completado`, {
      action: uploadResult.action,
      developmentId: uploadResult.developmentId,
      unitsCreated: uploadResult.unitsCreated,
      unitsUpdated: uploadResult.unitsUpdated,
    });

    // ====== DONE ======
    await finishJob(syncJob.id, "COMPLETED", folder.id);
    await logger.info("ORCHESTRATOR", `Pipeline completado exitosamente`);

    // Crear notificación para el equipo
    await createSyncNotification(uploadResult.developmentId, mapResult, uploadResult);

    return syncJob.id;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Error desconocido";
    await logger.error("ORCHESTRATOR", `Pipeline falló: ${errorMsg}`);
    await prisma.syncJob.update({
      where: { id: syncJob.id },
      data: {
        status: "FAILED",
        error: errorMsg,
        completedAt: new Date(),
      },
    });
    await prisma.monitoredFolder.update({
      where: { id: folder.id },
      data: { lastSyncStatus: "FAILED", lastSyncAt: new Date() },
    });
    throw error;
  }
}

/**
 * Parsea todos los archivos de un crawl result.
 * Combina resultados de múltiples archivos en un ParseResult unificado.
 */
async function parseFiles(
  crawlResult: CrawlResult,
  provider: "GOOGLE_DRIVE" | "DROPBOX",
  logger: SyncLogger,
): Promise<ParseResult> {
  const allUnits: ParsedUnit[] = [];
  const allImages: ParsedImage[] = [];
  let developmentData: ParsedDevelopment = {};
  const warnings: string[] = [];
  let totalConfidence = 0;
  let parseCount = 0;

  // Instanciar crawler para descargas
  const driveCrawler = provider === "GOOGLE_DRIVE" ? new DriveCrawler() : null;
  const dropboxCrawler = provider === "DROPBOX" ? new DropboxCrawler() : null;

  for (const file of crawlResult.files) {
    try {
      await logger.info("PARSE", `Procesando: ${file.name} (${file.category})`);

      // Descargar archivo
      let buffer: Buffer;
      if (driveCrawler) {
        buffer = await driveCrawler.downloadFileAsBuffer(file.id);
      } else if (dropboxCrawler) {
        buffer = await dropboxCrawler.downloadFileAsBuffer(file.id);
      } else {
        throw new Error("No crawler available");
      }

      const ext = path.extname(file.name).toLowerCase();

      switch (file.category) {
        case "PRICE_LIST": {
          if (SPREADSHEET_EXTENSIONS.has(ext)) {
            // Excel/CSV → parser directo
            const result = await parseExcelPriceList(buffer, file.name);
            allUnits.push(...result.units);
            await logger.info("PARSE", `Excel parseado: ${result.units.length} unidades`, result.metadata);
          } else {
            // PDF → Claude Vision
            const result = await parsePriceListPdf(buffer, file.mimeType, file.name);
            allUnits.push(...result.units);
            await logger.info("PARSE", `PDF lista de precios: ${result.units.length} unidades`);
          }
          parseCount++;
          totalConfidence += 0.8;
          break;
        }

        case "BROCHURE": {
          const result = await parseBrochure(buffer, file.mimeType);
          developmentData = { ...developmentData, ...result.development };
          totalConfidence += result.confidence;
          parseCount++;
          await logger.info("PARSE", `Brochure parseado: ${result.development.name || "sin nombre"}`);
          break;
        }

        case "RENDER":
        case "PHOTO":
        case "FLOOR_PLAN":
        case "MAP": {
          // Clasificación por nombre de archivo/carpeta (gratis, sin API)
          const imageResult = classifyImage(file.name, file.parentFolderName);
          allImages.push(imageResult);
          await logger.info("PARSE", `Imagen clasificada: ${imageResult.category} - ${imageResult.description}`);
          break;
        }

        case "AVAILABILITY": {
          // Tratar como lista de precios (suele ser un Excel de disponibilidad)
          if (SPREADSHEET_EXTENSIONS.has(ext)) {
            const result = await parseExcelPriceList(buffer, file.name);
            // Merge: actualizar status de unidades existentes
            mergeAvailability(allUnits, result.units);
            await logger.info("PARSE", `Disponibilidad mergeada: ${result.units.length} unidades`);
          }
          break;
        }

        default:
          warnings.push(`Archivo ignorado (categoría ${file.category}): ${file.name}`);
      }

      // Marcar archivo como procesado
      await prisma.syncFile.updateMany({
        where: {
          monitoredFolderId: crawlResult.folderId,
          externalFileId: file.id,
        },
        data: { lastProcessedAt: new Date() },
      });
    } catch (fileError) {
      const msg = fileError instanceof Error ? fileError.message : "Error desconocido";
      warnings.push(`Error procesando ${file.name}: ${msg}`);
      await logger.error("PARSE", `Error en archivo ${file.name}: ${msg}`);
    }
  }

  return {
    folderId: crawlResult.folderId,
    development: developmentData,
    units: deduplicateUnits(allUnits),
    images: allImages,
    warnings,
    confidence: parseCount > 0 ? totalConfidence / parseCount : 0,
    parsedAt: new Date(),
  };
}

/**
 * Mergea datos de disponibilidad con unidades ya parseadas.
 * Actualiza el status de unidades existentes.
 */
function mergeAvailability(existingUnits: ParsedUnit[], availabilityUnits: ParsedUnit[]) {
  const availMap = new Map(availabilityUnits.map((u) => [u.unitNumber, u]));

  for (const unit of existingUnits) {
    const avail = availMap.get(unit.unitNumber);
    if (avail?.status) {
      unit.status = avail.status;
    }
  }

  // Agregar unidades que solo aparecen en disponibilidad
  availMap.forEach((avail, unitNumber) => {
    if (!existingUnits.find((u) => u.unitNumber === unitNumber)) {
      existingUnits.push(avail);
    }
  });
}

/**
 * Deduplica unidades por unitNumber, manteniendo la versión con más datos.
 */
function deduplicateUnits(units: ParsedUnit[]): ParsedUnit[] {
  const map = new Map<string, ParsedUnit>();

  for (const unit of units) {
    if (!unit.unitNumber) continue;
    const existing = map.get(unit.unitNumber);
    if (!existing) {
      map.set(unit.unitNumber, unit);
    } else {
      // Merge: preferir valores no-null
      map.set(unit.unitNumber, {
        ...existing,
        ...Object.fromEntries(
          Object.entries(unit).filter(([, v]) => v != null && v !== undefined && v !== 0)
        ),
      } as ParsedUnit);
    }
  }

  const result: ParsedUnit[] = [];
  map.forEach((v) => result.push(v));
  return result;
}

// ---- Helpers ----

async function updateJobStatus(jobId: string, status: SyncStatus) {
  await prisma.syncJob.update({
    where: { id: jobId },
    data: { status },
  });
}

async function finishJob(jobId: string, status: SyncStatus, folderId: string) {
  await prisma.syncJob.update({
    where: { id: jobId },
    data: { status, completedAt: new Date() },
  });
  await prisma.monitoredFolder.update({
    where: { id: folderId },
    data: { lastSyncAt: new Date(), lastSyncStatus: status },
  });
}

async function createSyncNotification(
  developmentId: string,
  mapResult: { isUpdate: boolean; development: { name: string }; units: unknown[] },
  uploadResult: { unitsCreated: number; unitsUpdated: number },
) {
  // Notificar a todos los directores y gerentes
  const admins = await prisma.user.findMany({
    where: {
      role: { in: ["ADMIN", "DIRECTOR", "GERENTE"] },
      isActive: true,
      deletedAt: null,
    },
    select: { id: true },
  });

  const action = mapResult.isUpdate ? "actualizado" : "creado";
  const title = `Desarrollo ${action}: ${mapResult.development.name}`;
  const message = mapResult.isUpdate
    ? `Se actualizaron ${uploadResult.unitsUpdated} unidades y se crearon ${uploadResult.unitsCreated} nuevas.`
    : `Nuevo desarrollo con ${uploadResult.unitsCreated} unidades.`;

  for (const admin of admins) {
    await prisma.notification.create({
      data: {
        userId: admin.id,
        title,
        message,
        type: "sync_completed",
        link: `/developments/${developmentId}`,
      },
    });
  }
}

// ---- Exports para uso directo ----

export { DriveCrawler } from "./crawler/drive-crawler";
export { DropboxCrawler } from "./crawler/dropbox-crawler";
export { mapToSchema } from "./mapper/schema-mapper";
export { uploadToCRM } from "./uploader/crm-uploader";
export type { SyncJob, MonitoredFolder, CrawlResult, ParseResult, MapResult, UploadResult } from "./types";
