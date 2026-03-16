// ============================================================
// Dropbox Crawler Agent
// Conecta a carpetas compartidas de Dropbox
// ============================================================

import { AGENT_CONFIG } from "../config";
import { classifyFile, fileNeedsReprocessing } from "./file-classifier";
import type { CrawledFile, CrawlResult } from "../types";
import prisma from "@/lib/db";

interface DropboxFile {
  id: string;
  name: string;
  path_lower: string;
  size: number;
  server_modified: string;
  content_hash?: string;
}

interface DropboxListResponse {
  entries: Array<{ ".tag": string } & DropboxFile>;
  cursor: string;
  has_more: boolean;
}

export class DropboxCrawler {
  private accessToken: string;
  private baseUrl = "https://api.dropboxapi.com/2";
  private contentUrl = "https://content.dropboxapi.com/2";

  constructor() {
    this.accessToken = AGENT_CONFIG.dropbox.accessToken;
  }

  /**
   * Rastrea una carpeta de Dropbox y detecta archivos nuevos/modificados.
   */
  async crawlFolder(monitoredFolderId: string): Promise<CrawlResult> {
    const folder = await prisma.monitoredFolder.findUniqueOrThrow({
      where: { id: monitoredFolderId },
      include: { syncFiles: true },
    });

    const existingFiles = new Map(
      folder.syncFiles.map((f) => [f.externalFileId, f])
    );

    // Listar archivos recursivamente
    const dropboxFiles = await this.listFilesRecursive(folder.externalFolderId);

    const crawledFiles: CrawledFile[] = [];
    let newFiles = 0;
    let modifiedFiles = 0;

    for (const dbxFile of dropboxFiles) {
      const modifiedAt = new Date(dbxFile.server_modified);
      const existing = existingFiles.get(dbxFile.id);

      const isNew = !existing;
      const isModified = existing
        ? fileNeedsReprocessing(modifiedAt, existing.lastProcessedAt)
        : false;

      if (isNew) newFiles++;
      if (isModified) modifiedFiles++;

      if (!isNew && !isModified) continue;

      const mimeType = this.guessMimeType(dbxFile.name);
      const category = classifyFile(dbxFile.name, mimeType);

      crawledFiles.push({
        id: dbxFile.id,
        name: dbxFile.name,
        mimeType,
        size: dbxFile.size,
        modifiedAt,
        parentFolderName: folder.folderName,
        category,
        provider: "DROPBOX",
      });

      await prisma.syncFile.upsert({
        where: {
          monitoredFolderId_externalFileId: {
            monitoredFolderId: folder.id,
            externalFileId: dbxFile.id,
          },
        },
        create: {
          monitoredFolderId: folder.id,
          externalFileId: dbxFile.id,
          fileName: dbxFile.name,
          mimeType,
          fileSize: dbxFile.size,
          category,
          externalModifiedAt: modifiedAt,
          checksum: dbxFile.content_hash,
        },
        update: {
          fileName: dbxFile.name,
          mimeType,
          fileSize: dbxFile.size,
          category,
          externalModifiedAt: modifiedAt,
          checksum: dbxFile.content_hash,
        },
      });
    }

    return {
      folderId: folder.id,
      folderName: folder.folderName,
      provider: "DROPBOX",
      files: crawledFiles,
      totalFiles: dropboxFiles.length,
      newFiles,
      modifiedFiles,
      crawledAt: new Date(),
    };
  }

  /**
   * Descarga un archivo de Dropbox como Buffer.
   */
  async downloadFileAsBuffer(filePath: string): Promise<Buffer> {
    const response = await fetch(`${this.contentUrl}/files/download`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Dropbox-API-Arg": JSON.stringify({ path: filePath }),
      },
    });

    if (!response.ok) {
      throw new Error(`Dropbox download failed: ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  private async listFilesRecursive(folderPath: string): Promise<DropboxFile[]> {
    const allFiles: DropboxFile[] = [];
    let cursor: string | null = null;
    let hasMore = true;

    // Primera llamada
    const firstResponse = await this.apiCall("/files/list_folder", {
      path: folderPath,
      recursive: true,
      include_deleted: false,
      limit: 2000,
    });

    for (const entry of firstResponse.entries) {
      if (entry[".tag"] === "file") {
        allFiles.push(entry as DropboxFile);
      }
    }

    cursor = firstResponse.cursor;
    hasMore = firstResponse.has_more;

    // Paginar si hay más
    while (hasMore && cursor) {
      const response = await this.apiCall("/files/list_folder/continue", { cursor });
      for (const entry of response.entries) {
        if (entry[".tag"] === "file") {
          allFiles.push(entry as DropboxFile);
        }
      }
      cursor = response.cursor;
      hasMore = response.has_more;
    }

    return allFiles;
  }

  private async apiCall(endpoint: string, body: Record<string, unknown>): Promise<DropboxListResponse> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Dropbox API error: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<DropboxListResponse>;
  }

  private guessMimeType(fileName: string): string {
    const ext = fileName.split(".").pop()?.toLowerCase();
    const mimeMap: Record<string, string> = {
      pdf: "application/pdf",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      webp: "image/webp",
      gif: "image/gif",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      xls: "application/vnd.ms-excel",
      csv: "text/csv",
      mp4: "video/mp4",
      mov: "video/quicktime",
      doc: "application/msword",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    };
    return mimeMap[ext || ""] || "application/octet-stream";
  }
}
