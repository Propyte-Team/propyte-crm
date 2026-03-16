// ============================================================
// Schema Mapper — Transforma datos parseados al schema de Prisma
// Detecta duplicados, calcula cambios, valida datos
// ============================================================

import prisma from "@/lib/db";
import type {
  ParseResult,
  ParsedUnit,
  ParsedDevelopment,
  MappedDevelopment,
  MappedUnit,
  MapResult,
  DevelopmentChanges,
  MonitoredFolder,
} from "../types";

// Mapeo de tipo de unidad texto → enum de Prisma
// Incluye tipologías reales del mercado MX (Nativa Tulum, etc.)
const UNIT_TYPE_MAP: Record<string, MappedUnit["unitType"]> = {
  // Estudios (1 recámara)
  "1 REC": "DEPTO_1REC",
  "1 RECAMARA": "DEPTO_1REC",
  "1 BEDROOM": "DEPTO_1REC",
  "STUDIO": "DEPTO_1REC",
  "ESTUDIO": "DEPTO_1REC",
  "ESTUDIO PENTGARDEN": "DEPTO_1REC",
  "ESTUDIO PENTHOUSE": "PENTHOUSE",
  "ESTUDIO + SUITE PENTHOUSE": "PENTHOUSE",
  "ESTUDIO DOBLE PENTHOUSE": "PENTHOUSE",
  "ESTUDIO DOBLE ROOF": "PENTHOUSE",
  // 2 recámaras
  "2 REC": "DEPTO_2REC",
  "2 RECAMARAS": "DEPTO_2REC",
  "2 RECAMARAS PENTGARDEN": "DEPTO_2REC",
  "2 RECAMARAS LOCK-OFF": "DEPTO_2REC",
  "2 RECAMARAS CORNER": "DEPTO_2REC",
  "2 BEDROOMS": "DEPTO_2REC",
  "LOCK-OFF": "DEPTO_2REC",
  // 3 recámaras
  "3 REC": "DEPTO_3REC",
  "3 RECAMARAS": "DEPTO_3REC",
  "3 RECAMARAS CORNER": "DEPTO_3REC",
  "3 BEDROOMS": "DEPTO_3REC",
  "3+ REC": "DEPTO_3REC",
  "CORNER": "DEPTO_3REC",
  // Penthouses
  "PENTHOUSE": "PENTHOUSE",
  "PH": "PENTHOUSE",
  "PH SUITE": "PENTHOUSE",
  "PENTGARDEN": "DEPTO_1REC",
  // Otros
  "CASA": "CASA",
  "HOUSE": "CASA",
  "VILLA": "CASA",
  "TERRENO": "TERRENO",
  "LOTE": "TERRENO",
  "LOT": "TERRENO",
  "LAND": "TERRENO",
  "MACROLOTE": "MACROLOTE",
  "LOCAL": "LOCAL",
  "LOCAL COMERCIAL": "LOCAL",
  "COMMERCIAL": "LOCAL",
};

// Mapeo de status del desarrollo
const DEV_STATUS_MAP: Record<string, MappedDevelopment["status"]> = {
  "PREVENTA": "PREVENTA",
  "PRE-VENTA": "PREVENTA",
  "PRESALE": "PREVENTA",
  "CONSTRUCCION": "CONSTRUCCION",
  "EN CONSTRUCCION": "CONSTRUCCION",
  "UNDER CONSTRUCTION": "CONSTRUCCION",
  "ENTREGA_INMEDIATA": "ENTREGA_INMEDIATA",
  "ENTREGA INMEDIATA": "ENTREGA_INMEDIATA",
  "READY TO DELIVER": "ENTREGA_INMEDIATA",
  "LISTO": "ENTREGA_INMEDIATA",
};

/**
 * Mapea datos parseados al schema de Prisma.
 * Detecta si es un update o create.
 */
export async function mapToSchema(
  parseResult: ParseResult,
  folderConfig: {
    id: string;
    plaza: "PDC" | "TULUM" | "MERIDA";
    developmentType: "PROPIO" | "MASTERBROKER" | "CORRETAJE";
    developmentId?: string | null;
  },
): Promise<MapResult> {
  // 1. Determinar si el desarrollo ya existe
  let existingDevelopmentId = folderConfig.developmentId || undefined;
  let isUpdate = !!existingDevelopmentId;

  // Si no hay ID explícito, buscar por nombre
  if (!existingDevelopmentId && parseResult.development.name) {
    const existing = await prisma.development.findFirst({
      where: {
        name: { contains: parseResult.development.name, mode: "insensitive" },
        deletedAt: null,
      },
    });
    if (existing) {
      existingDevelopmentId = existing.id;
      isUpdate = true;
    }
  }

  // 2. Mapear unidades
  const mappedUnits = parseResult.units
    .filter((u) => u.unitNumber)
    .map(mapUnit);

  // 3. Calcular estadísticas de unidades
  const availableUnits = mappedUnits.filter((u) => u.status === "DISPONIBLE").length;
  const soldUnits = mappedUnits.filter((u) => u.status === "VENDIDA").length;
  const reservedUnits = mappedUnits.filter((u) => u.status === "APARTADA").length;
  const prices = mappedUnits.map((u) => u.price).filter((p) => p > 0);

  // 4. Mapear desarrollo
  const dev = parseResult.development;
  const mappedDevelopment: MappedDevelopment = {
    name: dev.name || "Desarrollo sin nombre",
    developerName: dev.developerName || "Desarrollador desconocido",
    developmentType: folderConfig.developmentType,
    location: dev.location || "Ubicación por definir",
    plaza: folderConfig.plaza,
    totalUnits: mappedUnits.length,
    availableUnits,
    soldUnits,
    reservedUnits,
    priceMin: prices.length > 0 ? Math.min(...prices) : 0,
    priceMax: prices.length > 0 ? Math.max(...prices) : 0,
    currency: (dev.commissionRate ? "MXN" : mappedUnits[0]?.currency) || "MXN",
    commissionRate: dev.commissionRate || getDefaultCommissionRate(folderConfig.developmentType),
    status: mapDevelopmentStatus(dev.status) || "PREVENTA",
    constructionProgress: dev.constructionProgress || 0,
    deliveryDate: dev.deliveryDate ? new Date(dev.deliveryDate) : undefined,
    brochureUrl: dev.brochureUrl,
    virtualTourUrl: dev.virtualTourUrl,
    amenities: dev.amenities || [],
    description: dev.description || `Desarrollo inmobiliario con ${mappedUnits.length} unidades`,
  };

  // 5. Si es update, calcular cambios
  let changes: DevelopmentChanges | undefined;
  if (isUpdate && existingDevelopmentId) {
    changes = await calculateChanges(existingDevelopmentId, mappedUnits);
  }

  return {
    folderId: folderConfig.id,
    development: mappedDevelopment,
    units: mappedUnits,
    isUpdate,
    existingDevelopmentId,
    changes,
    mappedAt: new Date(),
  };
}

/**
 * Mapea una unidad parseada al schema de Prisma.
 */
function mapUnit(parsed: ParsedUnit): MappedUnit {
  return {
    unitNumber: parsed.unitNumber,
    unitType: mapUnitType(parsed.unitType, parsed.bedrooms),
    area_m2: parsed.area_m2 || 0,
    price: parsed.price || 0,
    currency: parsed.currency || "MXN",
    floor: parsed.floor,
    status: parsed.status || "DISPONIBLE",
  };
}

/**
 * Mapea el tipo de unidad texto libre al enum de Prisma.
 */
function mapUnitType(
  rawType: string | undefined,
  bedrooms: number | undefined,
): MappedUnit["unitType"] {
  if (rawType) {
    const normalized = rawType.toUpperCase().trim();
    const mapped = UNIT_TYPE_MAP[normalized];
    if (mapped) return mapped;

    // Búsqueda parcial
    for (const [key, value] of Object.entries(UNIT_TYPE_MAP)) {
      if (normalized.includes(key) || key.includes(normalized)) {
        return value;
      }
    }
  }

  // Inferir del número de recámaras
  if (bedrooms) {
    if (bedrooms === 1) return "DEPTO_1REC";
    if (bedrooms === 2) return "DEPTO_2REC";
    if (bedrooms >= 3) return "DEPTO_3REC";
  }

  return "DEPTO_2REC"; // Default más común en mercado MX
}

function mapDevelopmentStatus(raw: string | undefined): MappedDevelopment["status"] | undefined {
  if (!raw) return undefined;
  const normalized = raw.toUpperCase().trim();
  return DEV_STATUS_MAP[normalized] || undefined;
}

function getDefaultCommissionRate(type: "PROPIO" | "MASTERBROKER" | "CORRETAJE"): number {
  const defaults = { PROPIO: 10, MASTERBROKER: 5, CORRETAJE: 6 };
  return defaults[type];
}

/**
 * Calcula los cambios entre el estado actual en DB y los nuevos datos.
 */
async function calculateChanges(
  developmentId: string,
  newUnits: MappedUnit[],
): Promise<DevelopmentChanges> {
  const existingUnits = await prisma.unit.findMany({
    where: { developmentId, deletedAt: null },
  });

  const existingMap = new Map(existingUnits.map((u) => [u.unitNumber, u]));
  const newMap = new Map(newUnits.map((u) => [u.unitNumber, u]));

  let priceChanges = 0;
  let statusChanges = 0;
  let newUnitCount = 0;
  const alerts: string[] = [];

  newMap.forEach((newUnit, unitNumber) => {
    const existing = existingMap.get(unitNumber);
    if (!existing) {
      newUnitCount++;
      return;
    }

    // Detectar cambio de precio
    const existingPrice = Number(existing.price);
    if (existingPrice !== newUnit.price && newUnit.price > 0) {
      priceChanges++;
      const pctChange = ((newUnit.price - existingPrice) / existingPrice) * 100;
      if (Math.abs(pctChange) > 20) {
        alerts.push(
          `${unitNumber}: precio cambió ${pctChange > 0 ? "+" : ""}${pctChange.toFixed(1)}% ($${existingPrice.toLocaleString()} → $${newUnit.price.toLocaleString()})`
        );
      }
    }

    // Detectar cambio de status
    if (existing.status !== newUnit.status) {
      statusChanges++;
      if (existing.status === "DISPONIBLE" && newUnit.status === "VENDIDA") {
        alerts.push(`${unitNumber}: vendida`);
      }
    }
  });

  // Unidades que ya no aparecen
  let removedUnits = 0;
  existingMap.forEach((_, un) => { if (!newMap.has(un)) removedUnits++; });
  if (removedUnits > 0) {
    alerts.push(`${removedUnits} unidades ya no aparecen en la lista actualizada`);
  }

  return {
    priceChanges,
    statusChanges,
    newUnits: newUnitCount,
    removedUnits,
    alerts,
  };
}
