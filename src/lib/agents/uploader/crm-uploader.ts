// ============================================================
// CRM Uploader — Escribe datos procesados al CRM (Prisma)
// Maneja creates y updates de desarrollos + unidades
// ============================================================

import prisma from "@/lib/db";
import type { MapResult, MappedUnit, UploadResult } from "../types";

/**
 * Sube los datos mapeados al CRM.
 * Crea o actualiza el desarrollo y sus unidades.
 */
export async function uploadToCRM(mapResult: MapResult): Promise<UploadResult> {
  const errors: string[] = [];
  let developmentId: string;
  let unitsCreated = 0;
  let unitsUpdated = 0;

  try {
    if (mapResult.isUpdate && mapResult.existingDevelopmentId) {
      // ---- UPDATE existente ----
      developmentId = mapResult.existingDevelopmentId;
      await updateDevelopment(developmentId, mapResult);
      const unitResult = await syncUnits(developmentId, mapResult.units);
      unitsCreated = unitResult.created;
      unitsUpdated = unitResult.updated;
    } else {
      // ---- CREATE nuevo ----
      const dev = await createDevelopment(mapResult);
      developmentId = dev.id;
      const unitResult = await createUnits(developmentId, mapResult.units);
      unitsCreated = unitResult.created;

      // Vincular la carpeta monitoreada al desarrollo
      await prisma.monitoredFolder.update({
        where: { id: mapResult.folderId },
        data: { developmentId },
      });
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Error desconocido";
    errors.push(msg);
    return {
      folderId: mapResult.folderId,
      developmentId: mapResult.existingDevelopmentId || "",
      action: mapResult.isUpdate ? "UPDATED" : "CREATED",
      unitsCreated: 0,
      unitsUpdated: 0,
      imagesUploaded: 0,
      uploadedAt: new Date(),
      errors,
    };
  }

  return {
    folderId: mapResult.folderId,
    developmentId,
    action: mapResult.isUpdate ? "UPDATED" : "CREATED",
    unitsCreated,
    unitsUpdated,
    imagesUploaded: 0, // TODO: implementar upload de imágenes
    uploadedAt: new Date(),
    errors,
  };
}

/**
 * Crea un nuevo desarrollo en el CRM.
 */
async function createDevelopment(mapResult: MapResult) {
  const d = mapResult.development;

  return prisma.development.create({
    data: {
      name: d.name,
      developerName: d.developerName,
      developmentType: d.developmentType,
      location: d.location,
      plaza: d.plaza,
      totalUnits: d.totalUnits,
      availableUnits: d.availableUnits,
      soldUnits: d.soldUnits,
      reservedUnits: d.reservedUnits,
      priceMin: d.priceMin,
      priceMax: d.priceMax,
      currency: d.currency,
      commissionRate: d.commissionRate,
      status: d.status,
      constructionProgress: d.constructionProgress,
      deliveryDate: d.deliveryDate,
      brochureUrl: d.brochureUrl,
      virtualTourUrl: d.virtualTourUrl,
      amenities: d.amenities,
      description: d.description,
      isActive: true,
    },
  });
}

/**
 * Actualiza un desarrollo existente con los nuevos datos.
 * Solo actualiza campos que tienen datos válidos.
 */
async function updateDevelopment(developmentId: string, mapResult: MapResult) {
  const d = mapResult.development;

  await prisma.development.update({
    where: { id: developmentId },
    data: {
      // Siempre actualizar inventario (es el dato más dinámico)
      totalUnits: d.totalUnits,
      availableUnits: d.availableUnits,
      soldUnits: d.soldUnits,
      reservedUnits: d.reservedUnits,
      priceMin: d.priceMin,
      priceMax: d.priceMax,
      // Actualizar solo si hay datos nuevos
      ...(d.constructionProgress > 0 && { constructionProgress: d.constructionProgress }),
      ...(d.deliveryDate && { deliveryDate: d.deliveryDate }),
      ...(d.amenities.length > 0 && { amenities: d.amenities }),
      ...(d.brochureUrl && { brochureUrl: d.brochureUrl }),
      ...(d.virtualTourUrl && { virtualTourUrl: d.virtualTourUrl }),
      ...(d.status && { status: d.status }),
    },
  });
}

/**
 * Crea unidades para un desarrollo nuevo.
 */
async function createUnits(
  developmentId: string,
  units: MappedUnit[],
): Promise<{ created: number }> {
  if (units.length === 0) return { created: 0 };

  const result = await prisma.unit.createMany({
    data: units.map((u) => ({
      developmentId,
      unitNumber: u.unitNumber,
      unitType: u.unitType,
      area_m2: u.area_m2,
      price: u.price,
      currency: u.currency,
      floor: u.floor,
      status: u.status,
    })),
    skipDuplicates: true,
  });

  return { created: result.count };
}

/**
 * Sincroniza unidades de un desarrollo existente.
 * - Actualiza unidades existentes (precio, status, area)
 * - Crea unidades nuevas
 * - NO elimina unidades que ya no aparecen (seguridad)
 */
async function syncUnits(
  developmentId: string,
  newUnits: MappedUnit[],
): Promise<{ created: number; updated: number }> {
  let created = 0;
  let updated = 0;

  // Obtener unidades existentes
  const existing = await prisma.unit.findMany({
    where: { developmentId, deletedAt: null },
  });
  const existingMap = new Map(existing.map((u) => [u.unitNumber, u]));

  for (const unit of newUnits) {
    const existingUnit = existingMap.get(unit.unitNumber);

    if (existingUnit) {
      // Update: solo si hay cambios reales
      const hasChanges =
        Number(existingUnit.price) !== unit.price ||
        existingUnit.status !== unit.status ||
        Number(existingUnit.area_m2) !== unit.area_m2;

      if (hasChanges) {
        await prisma.unit.update({
          where: { id: existingUnit.id },
          data: {
            price: unit.price,
            status: unit.status,
            area_m2: unit.area_m2,
            floor: unit.floor ?? existingUnit.floor,
            // Registrar fecha de venta si cambió a VENDIDA
            ...(unit.status === "VENDIDA" && existingUnit.status !== "VENDIDA" && {
              saleDate: new Date(),
              salePrice: unit.price,
            }),
          },
        });
        updated++;
      }
    } else {
      // Create nueva unidad
      await prisma.unit.create({
        data: {
          developmentId,
          unitNumber: unit.unitNumber,
          unitType: unit.unitType,
          area_m2: unit.area_m2,
          price: unit.price,
          currency: unit.currency,
          floor: unit.floor,
          status: unit.status,
        },
      });
      created++;
    }
  }

  return { created, updated };
}
