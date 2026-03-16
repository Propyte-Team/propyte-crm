// ============================================================
// Excel/CSV Parser — Parsea listas de precios en hojas de cálculo
// Sin APIs de pago — usa xlsx + mapeo automático por keywords
// ============================================================

import * as XLSX from "xlsx";
import type { ParsedUnit } from "../types";

interface ColumnMapping {
  mapping: Record<string, string>;
  statusMapping: Record<string, string>;
  currencyDetected: "MXN" | "USD";
  notes: string;
}

/**
 * Parsea un archivo Excel/CSV y extrae unidades.
 * 1. Lee el archivo con xlsx
 * 2. Auto-mapea columnas por keywords (sin AI)
 * 3. Extrae datos estructurados
 */
export async function parseExcelPriceList(fileBuffer: Buffer, fileName: string): Promise<{
  units: ParsedUnit[];
  metadata: Record<string, unknown>;
}> {
  const workbook = XLSX.read(fileBuffer, { type: "buffer" });
  const sheetName = findBestSheet(workbook);
  const sheet = workbook.Sheets[sheetName];
  const rawData = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

  if (rawData.length === 0) {
    return { units: [], metadata: { error: "Hoja vacía" } };
  }

  const headers = Object.keys(rawData[0]);
  const mapping = autoMapColumns(headers);

  const units = rawData
    .map((row) => applyMapping(row, mapping))
    .filter((unit) => unit.unitNumber);

  return {
    units,
    metadata: {
      sheetName,
      totalRows: rawData.length,
      mappedUnits: units.length,
      currency: mapping.currencyDetected,
      columnMapping: mapping.mapping,
      notes: mapping.notes,
      source: "xlsx parser (free)",
    },
  };
}

/**
 * Auto-mapea columnas por keywords — sin AI.
 */
function autoMapColumns(headers: string[]): ColumnMapping {
  const mapping: Record<string, string> = {};
  const patterns: Record<string, string[]> = {
    unitNumber: ["unidad", "unit", "numero", "no.", "no ", "lote", "depto", "dept", "clave", "id", "apartamento", "apt"],
    unitType: ["tipo", "type", "modelo", "model", "tipolog", "prototipo"],
    area_m2: ["area", "superficie", "m2", "m²", "metros", "sup.", "construccion", "terreno"],
    price: ["precio", "price", "valor", "costo", "monto", "venta", "lista", "total"],
    floor: ["piso", "nivel", "floor", "level", "planta"],
    status: ["status", "estado", "estatus", "disponibilidad", "disp"],
    bedrooms: ["recamara", "bedroom", "hab", "rec.", "recam"],
    bathrooms: ["bano", "baño", "bathroom", "wc"],
    view: ["vista", "view", "orientacion", "orientación"],
  };

  for (const header of headers) {
    const lower = header.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    let matched = false;

    for (const [field, keywords] of Object.entries(patterns)) {
      if (keywords.some((kw) => lower.includes(kw))) {
        // Evitar mapear dos columnas al mismo campo
        if (!Object.values(mapping).includes(field)) {
          mapping[header] = field;
          matched = true;
          break;
        }
      }
    }

    if (!matched) {
      mapping[header] = "SKIP";
    }
  }

  // Detectar moneda
  let currencyDetected: "MXN" | "USD" = "MXN";
  for (const header of headers) {
    const lower = header.toLowerCase();
    if (lower.includes("usd") || lower.includes("dolar") || lower.includes("dlls")) {
      currencyDetected = "USD";
      break;
    }
  }

  // Status mapping (valores comunes en celdas de estado)
  const statusMapping: Record<string, string> = {
    "disponible": "DISPONIBLE",
    "disp": "DISPONIBLE",
    "libre": "DISPONIBLE",
    "available": "DISPONIBLE",
    "d": "DISPONIBLE",
    "apartado": "APARTADA",
    "apartada": "APARTADA",
    "reservado": "APARTADA",
    "reservada": "APARTADA",
    "separado": "APARTADA",
    "separada": "APARTADA",
    "a": "APARTADA",
    "r": "APARTADA",
    "vendido": "VENDIDA",
    "vendida": "VENDIDA",
    "sold": "VENDIDA",
    "escriturado": "VENDIDA",
    "escriturada": "VENDIDA",
    "v": "VENDIDA",
    "no disponible": "NO_DISPONIBLE",
    "nd": "NO_DISPONIBLE",
  };

  return {
    mapping,
    statusMapping,
    currencyDetected,
    notes: `Auto-mapeo por keywords. ${Object.values(mapping).filter(v => v !== "SKIP").length}/${headers.length} columnas mapeadas`,
  };
}

/**
 * Aplica el mapeo de columnas a una fila del Excel.
 */
function applyMapping(row: Record<string, unknown>, mapping: ColumnMapping): ParsedUnit {
  const m = mapping.mapping;
  const reverseMap: Record<string, string> = {};

  for (const [original, target] of Object.entries(m)) {
    if (target !== "SKIP") {
      reverseMap[target] = original;
    }
  }

  const getValue = (field: string): string => {
    const col = reverseMap[field];
    if (!col) return "";
    const val = row[col];
    return val != null ? String(val).trim() : "";
  };

  const rawStatus = getValue("status").toLowerCase();
  const mappedStatus = rawStatus ? (mapping.statusMapping[rawStatus] || normalizeStatus(rawStatus)) : undefined;

  return {
    unitNumber: getValue("unitNumber"),
    unitType: getValue("unitType") || undefined,
    area_m2: parseFloat(getValue("area_m2")) || undefined,
    price: parsePrice(getValue("price")),
    currency: mapping.currencyDetected || "MXN",
    floor: parseInt(getValue("floor"), 10) || undefined,
    status: mappedStatus as ParsedUnit["status"],
    bedrooms: parseInt(getValue("bedrooms"), 10) || undefined,
    bathrooms: parseInt(getValue("bathrooms"), 10) || undefined,
    view: getValue("view") || undefined,
  };
}

function parsePrice(raw: string): number | undefined {
  if (!raw) return undefined;
  const cleaned = raw.replace(/[$,\s]/g, "").replace(/MXN|USD|mx|us/gi, "");
  const num = parseFloat(cleaned);
  return isNaN(num) ? undefined : num;
}

function findBestSheet(workbook: XLSX.WorkBook): string {
  let bestSheet = workbook.SheetNames[0];
  let maxRows = 0;

  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    const range = XLSX.utils.decode_range(sheet["!ref"] || "A1");
    const rows = range.e.r - range.s.r + 1;
    if (rows > maxRows) {
      maxRows = rows;
      bestSheet = name;
    }
  }

  return bestSheet;
}

function normalizeStatus(status: string): string | undefined {
  const s = status.toUpperCase().trim();
  if (s.includes("DISP") || s.includes("LIBRE")) return "DISPONIBLE";
  if (s.includes("APART") || s.includes("RESERV")) return "APARTADA";
  if (s.includes("VEND") || s.includes("SOLD")) return "VENDIDA";
  return undefined;
}
