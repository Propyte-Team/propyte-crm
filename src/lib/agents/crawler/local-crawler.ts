// ============================================================
// Local Crawler — Lee archivos desde una carpeta local
// Para pruebas y desarrollo sin necesidad de Drive/Dropbox
// ============================================================

import fs from "fs/promises";
import path from "path";
import { classifyFile } from "./file-classifier";
import type { CrawledFile, CrawlResult } from "../types";
import prisma from "@/lib/db";

export class LocalCrawler {
  /**
   * Rastrea una carpeta local recursivamente.
   */
  async crawlFolder(monitoredFolderId: string, localPath: string): Promise<CrawlResult> {
    const folder = await prisma.monitoredFolder.findUniqueOrThrow({
      where: { id: monitoredFolderId },
    });

    const files = await this.listFilesRecursive(localPath);
    const crawledFiles: CrawledFile[] = [];

    for (const filePath of files) {
      const stat = await fs.stat(filePath);
      const fileName = path.basename(filePath);
      const mimeType = this.guessMimeType(fileName);
      const category = classifyFile(fileName, mimeType);
      const fileId = filePath; // Use path as ID for local files

      crawledFiles.push({
        id: fileId,
        name: fileName,
        mimeType,
        size: stat.size,
        modifiedAt: stat.mtime,
        downloadUrl: filePath,
        localPath: filePath,
        parentFolderName: path.basename(path.dirname(filePath)),
        category,
        provider: "GOOGLE_DRIVE",
      });
    }

    return {
      folderId: folder.id,
      folderName: folder.folderName,
      provider: "GOOGLE_DRIVE",
      files: crawledFiles,
      totalFiles: files.length,
      newFiles: files.length,
      modifiedFiles: 0,
      crawledAt: new Date(),
    };
  }

  /**
   * Para local, el archivo ya está en disco.
   */
  async downloadFileAsBuffer(filePath: string): Promise<Buffer> {
    return fs.readFile(filePath);
  }

  private async listFilesRecursive(dirPath: string): Promise<string[]> {
    const results: string[] = [];
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        const subFiles = await this.listFilesRecursive(fullPath);
        results.push(...subFiles);
      } else if (!entry.name.startsWith(".")) {
        results.push(fullPath);
      }
    }

    return results;
  }

  private guessMimeType(fileName: string): string {
    const ext = path.extname(fileName).toLowerCase();
    const map: Record<string, string> = {
      ".pdf": "application/pdf",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".webp": "image/webp",
      ".gif": "image/gif",
      ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ".xls": "application/vnd.ms-excel",
      ".csv": "text/csv",
      ".mp4": "video/mp4",
      ".mov": "video/quicktime",
    };
    return map[ext] || "application/octet-stream";
  }
}
