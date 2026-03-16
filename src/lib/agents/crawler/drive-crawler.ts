// ============================================================
// Google Drive Crawler Agent
// Conecta a carpetas compartidas, detecta cambios, descarga archivos
// ============================================================

import { google, drive_v3 } from "googleapis";
import { AGENT_CONFIG, DRIVE_MIME_TYPES } from "../config";
import { classifyFile, fileNeedsReprocessing } from "./file-classifier";
import type { CrawledFile, CrawlResult } from "../types";
import fs from "fs/promises";
import path from "path";
import prisma from "@/lib/db";

export class DriveCrawler {
  private drive: drive_v3.Drive;

  constructor() {
    const auth = new google.auth.GoogleAuth({
      keyFile: AGENT_CONFIG.drive.serviceAccountKeyPath,
      scopes: [...AGENT_CONFIG.drive.scopes],
    });

    this.drive = google.drive({ version: "v3", auth });
  }

  /**
   * Rastrea una carpeta de Drive y detecta archivos nuevos/modificados.
   * Compara contra la tabla sync_files para identificar cambios.
   */
  async crawlFolder(monitoredFolderId: string): Promise<CrawlResult> {
    // Obtener la carpeta monitoreada de la DB
    const folder = await prisma.monitoredFolder.findUniqueOrThrow({
      where: { id: monitoredFolderId },
      include: { syncFiles: true },
    });

    const existingFiles = new Map(
      folder.syncFiles.map((f) => [f.externalFileId, f])
    );

    // Listar todos los archivos de la carpeta (recursivo)
    const driveFiles = await this.listFilesRecursive(folder.externalFolderId);

    const crawledFiles: CrawledFile[] = [];
    let newFiles = 0;
    let modifiedFiles = 0;

    for (const driveFile of driveFiles) {
      if (!driveFile.id || !driveFile.name || !driveFile.mimeType) continue;
      if (driveFile.mimeType === DRIVE_MIME_TYPES.folder) continue;

      const modifiedAt = new Date(driveFile.modifiedTime || Date.now());
      const existing = existingFiles.get(driveFile.id);

      const isNew = !existing;
      const isModified = existing
        ? fileNeedsReprocessing(modifiedAt, existing.lastProcessedAt)
        : false;

      if (isNew) newFiles++;
      if (isModified) modifiedFiles++;

      // Solo procesar archivos nuevos o modificados
      if (!isNew && !isModified) continue;

      const category = classifyFile(driveFile.name, driveFile.mimeType);

      crawledFiles.push({
        id: driveFile.id,
        name: driveFile.name,
        mimeType: driveFile.mimeType,
        size: parseInt(driveFile.size || "0", 10),
        modifiedAt,
        parentFolderName: folder.folderName,
        category,
        provider: "GOOGLE_DRIVE",
      });

      // Upsert en sync_files para tracking
      await prisma.syncFile.upsert({
        where: {
          monitoredFolderId_externalFileId: {
            monitoredFolderId: folder.id,
            externalFileId: driveFile.id,
          },
        },
        create: {
          monitoredFolderId: folder.id,
          externalFileId: driveFile.id,
          fileName: driveFile.name,
          mimeType: driveFile.mimeType,
          fileSize: parseInt(driveFile.size || "0", 10),
          category,
          externalModifiedAt: modifiedAt,
        },
        update: {
          fileName: driveFile.name,
          mimeType: driveFile.mimeType,
          fileSize: parseInt(driveFile.size || "0", 10),
          category,
          externalModifiedAt: modifiedAt,
        },
      });
    }

    return {
      folderId: folder.id,
      folderName: folder.folderName,
      provider: "GOOGLE_DRIVE",
      files: crawledFiles,
      totalFiles: driveFiles.length,
      newFiles,
      modifiedFiles,
      crawledAt: new Date(),
    };
  }

  /**
   * Descarga un archivo de Drive a un path temporal.
   */
  async downloadFile(fileId: string, fileName: string): Promise<string> {
    const tempDir = AGENT_CONFIG.sync.tempDir;
    await fs.mkdir(tempDir, { recursive: true });

    const destPath = path.join(tempDir, `${fileId}_${fileName}`);

    const response = await this.drive.files.get(
      { fileId, alt: "media" },
      { responseType: "stream" }
    );

    const writeStream = (await import("fs")).createWriteStream(destPath);

    return new Promise((resolve, reject) => {
      (response.data as NodeJS.ReadableStream)
        .pipe(writeStream)
        .on("finish", () => resolve(destPath))
        .on("error", reject);
    });
  }

  /**
   * Descarga un archivo como Buffer (para pasar a Claude Vision).
   */
  async downloadFileAsBuffer(fileId: string): Promise<Buffer> {
    const response = await this.drive.files.get(
      { fileId, alt: "media" },
      { responseType: "arraybuffer" }
    );

    return Buffer.from(response.data as ArrayBuffer);
  }

  /**
   * Lista archivos recursivamente dentro de una carpeta de Drive.
   */
  private async listFilesRecursive(
    folderId: string,
    allFiles: drive_v3.Schema$File[] = []
  ): Promise<drive_v3.Schema$File[]> {
    let pageToken: string | undefined;

    do {
      const response = await this.drive.files.list({
        q: `'${folderId}' in parents and trashed = false`,
        fields: "nextPageToken, files(id, name, mimeType, size, modifiedTime, parents)",
        pageSize: 1000,
        pageToken,
      });

      const files = response.data.files || [];

      for (const file of files) {
        if (file.mimeType === DRIVE_MIME_TYPES.folder) {
          // Recurrir en subcarpetas
          await this.listFilesRecursive(file.id!, allFiles);
        } else {
          allFiles.push(file);
        }
      }

      pageToken = response.data.nextPageToken || undefined;
    } while (pageToken);

    return allFiles;
  }

  /**
   * Verifica que el service account tiene acceso a la carpeta.
   */
  async verifyAccess(folderId: string): Promise<{ hasAccess: boolean; folderName?: string }> {
    try {
      const response = await this.drive.files.get({
        fileId: folderId,
        fields: "id, name, mimeType",
      });

      if (response.data.mimeType !== DRIVE_MIME_TYPES.folder) {
        return { hasAccess: false };
      }

      return { hasAccess: true, folderName: response.data.name || undefined };
    } catch {
      return { hasAccess: false };
    }
  }
}
