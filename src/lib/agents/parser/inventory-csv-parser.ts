// ============================================================
// Inventory CSV Parser — Lee inventario.csv (output del skill
// analista-inventario) como fuente de verdad para el sync
// ============================================================

import fs from "fs/promises";
import path from "path";
import type { ParsedUnit, ParsedDevelopment } from "../types";

// Path al inventario.csv (generado por analista-inventario)
const INVENTORY_CSV = path.resolve(process.cwd(), "../inventario.csv");
const PROJECTS_CSV = path.resolve(process.cwd(), "../proyectos.csv");

interface ProjectConfig {
  nombre_proyecto: string;
  desarrolladora: string;
  ciudad: string;
  url_carpeta_drive: string;
  notas: string;
  total_unidades: number;
  inicio_ventas: string;
  urls_imagenes: string; // URLs de carpetas de Drive con imágenes, separadas por |
}

/**
 * Lee inventario.csv y extrae todas las unidades de un proyecto.
 * Usa la revisión más reciente si hay múltiples.
 */
export async function parseInventoryCSV(projectName: string): Promise<{
  units: ParsedUnit[];
  project: ProjectConfig | null;
  metadata: Record<string, unknown>;
}> {
  // 1. Leer proyectos.csv para metadata del proyecto
  const project = await readProjectConfig(projectName);

  // 2. Leer inventario.csv
  const csvPath = await findInventoryCSV();
  if (!csvPath) {
    return { units: [], project, metadata: { error: "inventario.csv no encontrado" } };
  }

  const content = await fs.readFile(csvPath, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim());

  if (lines.length < 2) {
    return { units: [], project, metadata: { error: "inventario.csv vacío" } };
  }

  const headers = parseCSVLine(lines[0]);

  // Filtrar filas de este proyecto
  const projectRows = lines.slice(1)
    .map((line) => parseCSVLine(line))
    .filter((cols) => {
      const name = cols[headers.indexOf("proyecto")] || "";
      return name.toLowerCase().includes(projectName.toLowerCase());
    });

  // Agrupar por fecha_revision y tomar la más reciente
  const dateIdx = headers.indexOf("fecha_revision");
  const latestDate = projectRows
    .map((cols) => cols[dateIdx] || "")
    .filter(Boolean)
    .sort()
    .pop();

  const latestRows = latestDate
    ? projectRows.filter((cols) => cols[dateIdx] === latestDate)
    : projectRows;

  // Parsear unidades
  const units: ParsedUnit[] = [];
  const totalReal = project?.total_unidades || latestRows.length;

  for (const cols of latestRows) {
    const unit = rowToUnit(cols, headers);
    if (unit) units.push(unit);
  }

  const disponibles = units.filter((u) => u.status === "DISPONIBLE").length;
  const apartadas = units.filter((u) => u.status === "APARTADA").length;
  const vendidas = units.filter((u) => u.status === "VENDIDA").length;

  return {
    units,
    project,
    metadata: {
      source: csvPath,
      revision: latestDate,
      totalReal,
      disponibles,
      apartadas,
      vendidas,
      totalListadas: units.length,
    },
  };
}

/**
 * Convierte una fila del CSV a ParsedUnit.
 */
function rowToUnit(cols: string[], headers: string[]): ParsedUnit | null {
  const get = (field: string) => {
    const idx = headers.indexOf(field);
    return idx >= 0 ? (cols[idx] || "").trim() : "";
  };

  const unidad = get("unidad");
  if (!unidad) return null;

  // Determinar status
  let status: ParsedUnit["status"] = "DISPONIBLE";
  const rawStatus = get("estado").toLowerCase();
  if (rawStatus.includes("vendid") || rawStatus === "vendido") status = "VENDIDA";
  else if (rawStatus.includes("apartad") || rawStatus === "apartado") status = "APARTADA";
  else if (rawStatus.includes("disp") || rawStatus === "disponible") status = "DISPONIBLE";

  // Determinar tipo de unidad para el enum de Prisma
  const tipologia = get("tipologia") || get("tipo") || "";
  const recamaras = parseInt(get("recamaras"), 10) || undefined;

  const price = parseFloat(get("precio_lista_mxn")) || undefined;
  const area = parseFloat(get("superficie_m2")) || undefined;

  // Mapear piso
  const rawPiso = get("piso").toUpperCase();
  let floor: number | undefined;
  if (rawPiso === "PB" || rawPiso === "PLANTA BAJA") floor = 0;
  else if (rawPiso.includes("NIVEL")) {
    const m = rawPiso.match(/NIVEL\s*(\d+)/);
    if (m) floor = parseInt(m[1], 10);
  } else {
    floor = parseInt(rawPiso, 10) || undefined;
  }

  return {
    unitNumber: unidad,
    unitType: tipologia || get("tipo"),
    area_m2: area,
    price,
    currency: "MXN",
    floor,
    status,
    bedrooms: recamaras,
    extras: get("alberca") === "SI" ? "Alberca privada" : undefined,
  };
}

/**
 * Lee proyectos.csv para obtener metadata del proyecto.
 */
async function readProjectConfig(projectName: string): Promise<ProjectConfig | null> {
  try {
    const csvPath = await findFile(PROJECTS_CSV);
    if (!csvPath) return null;

    const content = await fs.readFile(csvPath, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim());
    if (lines.length < 2) return null;

    const headers = parseCSVLine(lines[0]);

    for (let i = 1; i < lines.length; i++) {
      const cols = parseCSVLine(lines[i]);
      const name = cols[headers.indexOf("nombre_proyecto")] || "";
      if (name.toLowerCase().includes(projectName.toLowerCase())) {
        return {
          nombre_proyecto: name,
          desarrolladora: cols[headers.indexOf("desarrolladora")] || "",
          ciudad: cols[headers.indexOf("ciudad")] || "",
          url_carpeta_drive: cols[headers.indexOf("url_carpeta_drive")] || "",
          notas: cols[headers.indexOf("notas")] || "",
          total_unidades: parseFloat(cols[headers.indexOf("total_unidades")] || "0"),
          inicio_ventas: cols[headers.indexOf("inicio_ventas")] || "",
          urls_imagenes: cols[headers.indexOf("urls_imagenes")] || "",
        };
      }
    }
  } catch {
    return null;
  }
  return null;
}

async function findInventoryCSV(): Promise<string | null> {
  // Buscar en múltiples ubicaciones posibles
  const candidates = [
    INVENTORY_CSV,
    path.resolve(process.cwd(), "inventario.csv"),
    path.resolve(process.cwd(), "../inventario.csv"),
  ];
  return findFile(...candidates);
}

async function findFile(...paths: string[]): Promise<string | null> {
  for (const p of paths) {
    try {
      await fs.access(p);
      return p;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Parsea una línea CSV respetando comillas.
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}
