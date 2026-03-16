// ============================================================
// File Classifier — Clasifica archivos por extensión y nombre
// ============================================================

import { FileCategory } from "../types";
import { AGENT_CONFIG, IMAGE_EXTENSIONS, DOCUMENT_EXTENSIONS, SPREADSHEET_EXTENSIONS } from "../config";
import path from "path";

/**
 * Clasifica un archivo en una categoría basado en su nombre y extensión.
 * Usa heurísticas simples antes de recurrir a Claude Vision.
 */
export function classifyFile(fileName: string, mimeType: string): FileCategory {
  const ext = path.extname(fileName).toLowerCase();
  const nameLower = fileName.toLowerCase();
  const { fileClassification } = AGENT_CONFIG;

  // 1. Hojas de cálculo → probablemente lista de precios/disponibilidad
  if (SPREADSHEET_EXTENSIONS.has(ext) || mimeType.includes("spreadsheet")) {
    if (matchesPattern(nameLower, fileClassification.priceList.namePatterns)) {
      return "PRICE_LIST";
    }
    // Por defecto, Excel/CSV en carpeta de desarrollo = lista de precios
    return "PRICE_LIST";
  }

  // 2. PDFs → brochure o lista de precios
  if (ext === ".pdf" || mimeType === "application/pdf") {
    if (matchesPattern(nameLower, fileClassification.brochure.namePatterns)) {
      return "BROCHURE";
    }
    if (matchesPattern(nameLower, fileClassification.priceList.namePatterns)) {
      return "PRICE_LIST";
    }
    if (matchesPattern(nameLower, fileClassification.floorPlan.namePatterns)) {
      return "FLOOR_PLAN";
    }
    // PDFs sin categoría clara → brochure por defecto
    return "BROCHURE";
  }

  // 3. Imágenes → render, plano, o foto
  if (IMAGE_EXTENSIONS.has(ext) || mimeType.startsWith("image/")) {
    if (matchesPattern(nameLower, fileClassification.floorPlan.namePatterns)) {
      return "FLOOR_PLAN";
    }
    if (matchesPattern(nameLower, fileClassification.render.namePatterns)) {
      return "RENDER";
    }
    if (nameLower.includes("mapa") || nameLower.includes("map") || nameLower.includes("ubicacion")) {
      return "MAP";
    }
    if (nameLower.includes("foto") || nameLower.includes("photo") || nameLower.includes("img_") || nameLower.includes("dsc")) {
      return "PHOTO";
    }
    // Imágenes sin categoría clara → render (más común en materiales comerciales)
    return "RENDER";
  }

  // 4. Videos → recorrido virtual
  if (mimeType.startsWith("video/") || [".mp4", ".mov", ".avi", ".webm"].includes(ext)) {
    return "VIDEO";
  }

  return "UNKNOWN";
}

function matchesPattern(fileName: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => fileName.includes(pattern));
}

/**
 * Determina si un archivo ha cambiado comparando con datos previos.
 * Retorna true si debe ser reprocesado.
 */
export function fileNeedsReprocessing(
  externalModifiedAt: Date,
  lastProcessedAt: Date | null,
): boolean {
  if (!lastProcessedAt) return true;
  return externalModifiedAt > lastProcessedAt;
}
