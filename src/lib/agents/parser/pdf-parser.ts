// ============================================================
// PDF Parser — Extrae datos de listas de precios y brochures
// SIN APIs de pago — usa pdf-parse (gratis) + pattern matching
// Mismo approach que el skill analista-inventario
// ============================================================

import * as pdfParse from "pdf-parse";
const pdf = (pdfParse as any).default || pdfParse;
import path from "path";
import type { ParsedUnit, ParsedDevelopment, ParsedImage } from "../types";

/**
 * Parsea una lista de precios en PDF.
 * Extrae texto con pdf-parse y luego usa regex/heurísticas para
 * identificar unidades, precios, estados y superficies.
 */
export async function parsePriceListPdf(
  fileBuffer: Buffer,
  mimeType: string,
  fileName: string,
): Promise<{ units: ParsedUnit[]; metadata: Record<string, unknown> }> {
  const data = await pdf(fileBuffer);
  const text = data.text;
  const lines = text.split("\n").map((l: string) => l.trim()).filter(Boolean);

  const units: ParsedUnit[] = [];
  let currency: "MXN" | "USD" = "MXN";

  // Detectar moneda
  if (text.includes("USD") || text.includes("dlls") || text.includes("dollars")) {
    currency = "USD";
  }

  // Detectar total real de unidades (ej: "SOLO 26/75 UNIDADES")
  let totalReal: number | undefined;
  const totalMatch = text.match(/(\d+)\s*\/\s*(\d+)\s*unidades/i) ||
    text.match(/(\d+)\s*de\s*(\d+)\s*unidades/i);
  if (totalMatch) {
    totalReal = parseInt(totalMatch[2], 10);
  }

  // Estrategia 1: Buscar filas tipo tabla con patrón de unidad
  // Patrones comunes: "A-101  2 REC  85.5 m²  $4,500,000  DISPONIBLE"
  for (const line of lines) {
    const unit = tryParseUnitLine(line, currency);
    if (unit) {
      units.push(unit);
    }
  }

  // Estrategia 2: Si no encontramos unidades, buscar bloques de datos
  if (units.length === 0) {
    const blockUnits = tryParseBlocks(lines, currency);
    units.push(...blockUnits);
  }

  // Detectar vendidas por color/texto
  detectSoldUnits(text, units);

  return {
    units,
    metadata: {
      developmentName: extractDevelopmentName(text, fileName),
      totalUnits: totalReal || units.length,
      currency,
      pdfPages: data.numpages,
      textLength: text.length,
      source: "pdf-parse (free)",
    },
  };
}

/**
 * Parsea un brochure comercial.
 * Extrae info del desarrollo: nombre, ubicación, amenidades, etc.
 */
export async function parseBrochure(
  fileBuffer: Buffer,
  mimeType: string,
): Promise<{ development: ParsedDevelopment; confidence: number }> {
  const data = await pdf(fileBuffer);
  const text = data.text;

  const development: ParsedDevelopment = {};

  // Extraer nombre (generalmente en las primeras líneas, en mayúsculas)
  const firstLines = text.split("\n").slice(0, 10).map((l: string) => l.trim()).filter(Boolean);
  for (const line of firstLines) {
    if (line.length > 3 && line.length < 100 && line === line.toUpperCase()) {
      development.name = titleCase(line);
      break;
    }
  }

  // Ubicación
  const locationMatch = text.match(/(carretera|av\.|avenida|calle|km\.?\s*\d+)[^.]{10,80}/i);
  if (locationMatch) {
    development.location = locationMatch[0].trim();
  }

  // Amenidades
  const amenityKeywords = [
    "alberca", "pool", "gym", "gimnasio", "rooftop", "coworking",
    "yoga", "spa", "restaurante", "bar", "lobby", "terraza",
    "jardín", "estacionamiento", "seguridad", "kids club",
    "salón de eventos", "fire pit", "juice bar", "beach club",
  ];
  const amenities = amenityKeywords.filter((kw) =>
    text.toLowerCase().includes(kw)
  );
  if (amenities.length > 0) {
    development.amenities = amenities.map(titleCase);
  }

  // Fecha de entrega
  const deliveryMatch = text.match(/entrega[:\s]*([\w\s]+20\d{2})/i) ||
    text.match(/(Q[1-4]\s*20\d{2})/i) ||
    text.match(/(20\d{2})/);
  if (deliveryMatch) {
    development.deliveryDate = deliveryMatch[1].trim();
  }

  // Avance de obra
  const progressMatch = text.match(/(\d{1,3})\s*%\s*(de\s*)?(avance|obra|construcci)/i);
  if (progressMatch) {
    development.constructionProgress = parseInt(progressMatch[1], 10);
  }

  // Status
  if (text.match(/preventa/i)) development.status = "PREVENTA";
  else if (text.match(/construcci[oó]n/i)) development.status = "CONSTRUCCION";
  else if (text.match(/entrega\s*inmediata/i)) development.status = "ENTREGA_INMEDIATA";

  // Comisión
  const commMatch = text.match(/comisi[oó]n[:\s]*(\d+(?:\.\d+)?)\s*%/i);
  if (commMatch) {
    development.commissionRate = parseFloat(commMatch[1]);
  }

  // Descripción: tomar primer párrafo largo
  const paragraphs = text.split(/\n{2,}/).map((p: string) => p.trim()).filter((p: string) => p.length > 50);
  if (paragraphs.length > 0) {
    development.description = paragraphs[0].slice(0, 500);
  }

  const confidence = Object.values(development).filter(Boolean).length / 8;

  return { development, confidence };
}

/**
 * Clasifica una imagen basándose en su nombre de archivo y carpeta.
 * NO usa AI — solo heurísticas por nombre.
 */
export function classifyImage(
  fileName: string,
  parentFolder: string,
): ParsedImage {
  const name = fileName.toLowerCase();
  const folder = parentFolder.toLowerCase();

  let category: ParsedImage["category"] = "PHOTO";

  // Por carpeta
  if (folder.includes("render")) category = "RENDER_EXTERIOR";
  else if (folder.includes("interior")) category = "RENDER_INTERIOR";
  else if (folder.includes("tipolog") || folder.includes("plano") || folder.includes("unit")) category = "FLOOR_PLAN";
  else if (folder.includes("amenid")) category = "AMENITY";
  else if (folder.includes("foto") || folder.includes("photo") || folder.includes("obra")) category = "PHOTO";
  else if (folder.includes("mapa") || folder.includes("map")) category = "MAP";

  // Por nombre de archivo (override)
  if (name.includes("exterior") || name.includes("fachada")) category = "RENDER_EXTERIOR";
  else if (name.includes("interior") || name.includes("recamara") || name.includes("estudio") || name.includes("lock")) category = "RENDER_INTERIOR";
  else if (name.includes("plano") || name.includes("planta") || name.includes("floor") || name.includes("layout")) category = "FLOOR_PLAN";
  else if (name.includes("gym") || name.includes("alberca") || name.includes("pool") || name.includes("cowork") || name.includes("salon") || name.includes("yoga") || name.includes("bar") || name.includes("fire")) category = "AMENITY";
  else if (name.includes("mapa") || name.includes("ubica")) category = "MAP";
  else if (name.includes("render") || name.includes("ex_")) category = "RENDER_EXTERIOR";

  // Generar descripción automática del nombre
  const description = fileName
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]/g, " ")
    .replace(/\b(copia de|copy of)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  return {
    sourceFileId: fileName,
    category,
    description: description || fileName,
  };
}

// ---- Helpers para parsear líneas de listas de precios ----

/**
 * Intenta parsear una línea como fila de tabla de lista de precios.
 * Busca patrones como: "NT-101 | 2 REC | 85 m2 | $4,500,000 | DISPONIBLE"
 */
function tryParseUnitLine(line: string, defaultCurrency: "MXN" | "USD"): ParsedUnit | null {
  // Patrón de número de unidad: letras+números con guión o punto
  const unitNumberMatch = line.match(/\b([A-Z]{1,5}[-.\s]?\d{2,5}[A-Z]?)\b/i);
  if (!unitNumberMatch) return null;

  // Debe tener un precio
  const priceMatch = line.match(/\$?\s*([\d,]+(?:\.\d{2})?)/);
  if (!priceMatch) return null;

  const price = parseFloat(priceMatch[1].replace(/,/g, ""));
  // Filtrar precios irreales (muy bajos o muy altos)
  if (price < 100000 || price > 500000000) return null;

  // Superficie
  const areaMatch = line.match(/([\d.]+)\s*(?:m2|m²|mts|metros)/i);
  const area = areaMatch ? parseFloat(areaMatch[1]) : undefined;

  // Status
  let status: ParsedUnit["status"] = "DISPONIBLE";
  const lineLower = line.toLowerCase();
  if (lineLower.includes("vendid") || lineLower.includes("sold") || lineLower.includes("escritur")) {
    status = "VENDIDA";
  } else if (lineLower.includes("apart") || lineLower.includes("reserv") || lineLower.includes("separ")) {
    status = "APARTADA";
  } else if (lineLower.includes("no disp")) {
    status = "NO_DISPONIBLE";
  }

  // Tipo
  let unitType: string | undefined;
  if (lineLower.includes("estudio") || lineLower.includes("studio")) unitType = "ESTUDIO";
  else if (lineLower.includes("penthouse") || lineLower.includes("ph")) unitType = "PENTHOUSE";
  else if (lineLower.includes("3 rec") || lineLower.includes("3rec")) unitType = "3 REC";
  else if (lineLower.includes("2 rec") || lineLower.includes("2rec")) unitType = "2 REC";
  else if (lineLower.includes("1 rec") || lineLower.includes("1rec")) unitType = "1 REC";
  else if (lineLower.includes("local")) unitType = "LOCAL";
  else if (lineLower.includes("casa") || lineLower.includes("villa")) unitType = "CASA";
  else if (lineLower.includes("lote") || lineLower.includes("terreno")) unitType = "TERRENO";

  // Piso
  const floorMatch = line.match(/(?:piso|nivel|floor|pb|p\.?b\.?)\s*(\d+)/i) ||
    line.match(/\b(\d{1,2})(?:er|do|to|vo)?\s*(?:piso|nivel)\b/i);
  const floor = floorMatch ? parseInt(floorMatch[1], 10) : undefined;

  // Recámaras
  const bedroomMatch = line.match(/(\d)\s*(?:rec[aá]mara|rec\.?|bedroom|hab)/i);
  const bedrooms = bedroomMatch ? parseInt(bedroomMatch[1], 10) : undefined;

  return {
    unitNumber: unitNumberMatch[1].toUpperCase(),
    unitType,
    area_m2: area,
    price,
    currency: defaultCurrency,
    floor,
    status,
    bedrooms,
  };
}

/**
 * Intenta parsear bloques de datos cuando no hay tabla clara.
 * Busca grupos de datos relacionados cercanos en el texto.
 */
function tryParseBlocks(lines: string[], currency: "MXN" | "USD"): ParsedUnit[] {
  const units: ParsedUnit[] = [];
  let currentUnit: Partial<ParsedUnit> = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detectar inicio de unidad
    const unitMatch = line.match(/\b([A-Z]{1,5}[-.\s]?\d{2,5}[A-Z]?)\b/i);
    if (unitMatch && line.length < 30) {
      // Guardar unidad anterior si tiene datos
      if (currentUnit.unitNumber && currentUnit.price) {
        units.push(currentUnit as ParsedUnit);
      }
      currentUnit = { unitNumber: unitMatch[1].toUpperCase(), currency };
      continue;
    }

    // Agregar datos a la unidad actual
    if (currentUnit.unitNumber) {
      const priceMatch = line.match(/\$?\s*([\d,]+(?:\.\d{2})?)/);
      if (priceMatch) {
        const p = parseFloat(priceMatch[1].replace(/,/g, ""));
        if (p > 100000) currentUnit.price = p;
      }

      const areaMatch = line.match(/([\d.]+)\s*(?:m2|m²)/i);
      if (areaMatch) currentUnit.area_m2 = parseFloat(areaMatch[1]);

      if (line.toLowerCase().includes("vendid")) currentUnit.status = "VENDIDA";
      else if (line.toLowerCase().includes("apart")) currentUnit.status = "APARTADA";
      else if (line.toLowerCase().includes("disp")) currentUnit.status = "DISPONIBLE";
    }
  }

  // Última unidad
  if (currentUnit.unitNumber && currentUnit.price) {
    units.push(currentUnit as ParsedUnit);
  }

  return units;
}

/**
 * Detecta unidades vendidas por texto o patrones visuales en el PDF.
 */
function detectSoldUnits(fullText: string, units: ParsedUnit[]) {
  // Buscar menciones de "VENDIDO" cerca de números de unidad
  const soldPattern = /([A-Z]{1,5}[-.\s]?\d{2,5}[A-Z]?)\s*(?:[-–—|:]?\s*)?(?:vendid[oa]|sold)/gi;
  let match;
  while ((match = soldPattern.exec(fullText)) !== null) {
    const unitNum = match[1].toUpperCase();
    const unit = units.find((u) => u.unitNumber === unitNum);
    if (unit) {
      unit.status = "VENDIDA";
    }
  }
}

/**
 * Extrae el nombre del desarrollo del texto o nombre del archivo.
 */
function extractDevelopmentName(text: string, fileName: string): string {
  // Buscar en las primeras líneas
  const firstLines = text.split("\n").slice(0, 5).map((l) => l.trim()).filter(Boolean);
  for (const line of firstLines) {
    if (line.length > 3 && line.length < 60 && /[A-Z]/.test(line)) {
      return titleCase(line);
    }
  }

  // Fallback al nombre del archivo
  return fileName.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ").trim();
}

function titleCase(str: string): string {
  return str.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}
