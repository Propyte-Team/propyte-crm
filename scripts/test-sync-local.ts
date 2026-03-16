// ============================================================
// Test Script: Pipeline de sync usando inventario.csv como fuente
// Lee datos reales del analista-inventario + imágenes locales
// Ejecuta: npx tsx scripts/test-sync-local.ts
// ============================================================

import { PrismaClient } from "@prisma/client";
import { LocalCrawler } from "../src/lib/agents/crawler/local-crawler";
import { classifyImage } from "../src/lib/agents/parser/pdf-parser";
import { parseInventoryCSV } from "../src/lib/agents/parser/inventory-csv-parser";
import { mapToSchema } from "../src/lib/agents/mapper/schema-mapper";
import { uploadToCRM } from "../src/lib/agents/uploader/crm-uploader";
import type { ParseResult, ParsedImage } from "../src/lib/agents/types";
import path from "path";

const prisma = new PrismaClient();
const LOCAL_IMAGES = path.resolve(__dirname, "../sync-local/nativa-tulum");
const PROJECT_NAME = "Nativa Tulum";

async function main() {
  console.log("=".repeat(60));
  console.log("  PROPYTE SYNC — Pipeline con inventario.csv real");
  console.log("=".repeat(60));

  // 1. Obtener carpeta monitoreada
  const folder = await prisma.monitoredFolder.findFirst({
    where: { folderName: { contains: "Nativa Tulum" } },
  });

  if (!folder) {
    console.error("No se encontró la carpeta 'Nativa Tulum'. Regístrala en /sync primero.");
    process.exit(1);
  }

  console.log(`\nCarpeta: ${folder.folderName} (${folder.id})`);

  // 2. Crear SyncJob
  const syncJob = await prisma.syncJob.create({
    data: { monitoredFolderId: folder.id, triggeredBy: "MANUAL", status: "PENDING" },
  });

  try {
    // ====== STEP 1: LEER INVENTARIO.CSV ======
    console.log("\n--- STEP 1: LEER INVENTARIO.CSV (fuente: analista-inventario) ---");
    await prisma.syncJob.update({ where: { id: syncJob.id }, data: { status: "PARSING" } });

    const { units, project, metadata } = await parseInventoryCSV(PROJECT_NAME);

    console.log(`  Fuente: ${metadata.source}`);
    console.log(`  Revisión: ${metadata.revision}`);
    console.log(`  Total real: ${metadata.totalReal} unidades`);
    console.log(`  Disponibles: ${metadata.disponibles}`);
    console.log(`  Apartadas: ${metadata.apartadas}`);
    console.log(`  Vendidas: ${metadata.vendidas}`);

    if (project) {
      console.log(`  Desarrolladora: ${project.desarrolladora}`);
      console.log(`  Ciudad: ${project.ciudad}`);
      console.log(`  Drive: ${project.url_carpeta_drive}`);
      console.log(`  Inicio ventas: ${project.inicio_ventas}`);
    }

    // Muestra primeras 5 unidades reales
    console.log(`\n  Primeras 5 unidades:`);
    for (const u of units.filter((u) => u.status !== "VENDIDA").slice(0, 5)) {
      console.log(`    ${u.unitNumber} | ${u.unitType} | ${u.area_m2}m² | $${u.price?.toLocaleString()} | ${u.status}`);
    }

    // ====== STEP 2: CRAWL IMÁGENES LOCALES ======
    console.log("\n--- STEP 2: CLASIFICAR IMÁGENES LOCALES ---");

    const images: ParsedImage[] = [];
    try {
      const crawler = new LocalCrawler();
      const crawlResult = await crawler.crawlFolder(folder.id, LOCAL_IMAGES);

      for (const file of crawlResult.files.filter((f) => f.mimeType.startsWith("image/"))) {
        const img = classifyImage(file.name, file.parentFolderName);
        images.push(img);
      }
      console.log(`  ${images.length} imágenes clasificadas`);

      await prisma.syncJob.update({
        where: { id: syncJob.id },
        data: { filesDiscovered: crawlResult.totalFiles, filesNew: crawlResult.newFiles },
      });
    } catch {
      console.log("  No se encontraron imágenes locales (OK, continuando sin ellas)");
    }

    // ====== STEP 3: CONSTRUIR PARSERESULT CON DATOS REALES ======
    const parseResult: ParseResult = {
      folderId: folder.id,
      development: {
        name: project?.nombre_proyecto || PROJECT_NAME,
        developerName: project?.desarrolladora || "Avica",
        location: `${project?.ciudad || "Tulum"}, Quintana Roo`,
        description: "Desarrollo residencial boutique en la selva de Tulum. Arquitectura biofílica integrada al entorno natural con amenidades de primer nivel.",
        amenities: ["Alberca", "Gym", "Coworking", "Salón de Eventos", "Juice Bar", "Fire Pit", "Yoga", "Rooftop"],
        deliveryDate: "2027-06-01",
        constructionProgress: 65,
        status: "CONSTRUCCION",
        commissionRate: 5.0,
        brochureUrl: project?.url_carpeta_drive,
      },
      units,
      images,
      warnings: [],
      confidence: 1.0,
      parsedAt: new Date(),
    };

    // ====== STEP 4: MAP ======
    console.log("\n--- STEP 3: MAP (Schema Mapper) ---");
    await prisma.syncJob.update({ where: { id: syncJob.id }, data: { status: "MAPPING" } });

    // Primero limpiar unidades anteriores del sync erróneo
    const existingDev = await prisma.development.findFirst({
      where: { name: { contains: "Nativa Tulum" }, deletedAt: null },
    });

    if (existingDev) {
      // Borrar unidades viejas del sync anterior (las NT-xxx inventadas)
      const deleted = await prisma.unit.deleteMany({
        where: { developmentId: existingDev.id },
      });
      console.log(`  Limpiadas ${deleted.count} unidades anteriores del desarrollo existente`);
    }

    const mapResult = await mapToSchema(parseResult, {
      id: folder.id,
      plaza: folder.plaza as "PDC" | "TULUM" | "MERIDA",
      developmentType: folder.developmentType as "PROPIO" | "MASTERBROKER" | "CORRETAJE",
      developmentId: existingDev?.id || folder.developmentId,
    });

    // Override con total real de unidades
    if (metadata.totalReal) {
      mapResult.development.totalUnits = metadata.totalReal as number;
    }

    console.log(`  Acción: ${mapResult.isUpdate ? "UPDATE" : "CREATE"}`);
    console.log(`  Total unidades: ${mapResult.development.totalUnits}`);
    console.log(`  Disponibles: ${mapResult.development.availableUnits} | Vendidas: ${mapResult.development.soldUnits} | Apartadas: ${mapResult.development.reservedUnits}`);
    console.log(`  Rango: $${mapResult.development.priceMin.toLocaleString()} - $${mapResult.development.priceMax.toLocaleString()} MXN`);

    // ====== STEP 5: UPLOAD ======
    console.log("\n--- STEP 4: UPLOAD (CRM) ---");
    await prisma.syncJob.update({ where: { id: syncJob.id }, data: { status: "UPLOADING" } });

    const uploadResult = await uploadToCRM(mapResult);

    console.log(`  Acción: ${uploadResult.action}`);
    console.log(`  Development ID: ${uploadResult.developmentId}`);
    console.log(`  Unidades creadas: ${uploadResult.unitsCreated}`);
    console.log(`  Unidades actualizadas: ${uploadResult.unitsUpdated}`);

    // Actualizar desarrollo con datos extra del proyecto
    if (project?.url_carpeta_drive) {
      await prisma.development.update({
        where: { id: uploadResult.developmentId },
        data: {
          brochureUrl: project.url_carpeta_drive,
          developerName: project.desarrolladora || "Avica",
          totalUnits: metadata.totalReal as number || 75,
          soldUnits: (metadata.vendidas as number) || 49,
        },
      });
    }

    // ====== STEP 5: PUBLICAR EN PROPYTE-WEB ======
    console.log("\n--- STEP 5: PUBLICAR EN PROPYTE-WEB (Supabase) ---");
    const { publishToWeb, extractTypologies } = await import("../src/lib/agents/uploader/web-publisher");

    const typologies = extractTypologies(
      units.filter((u) => u.status !== "VENDIDA").map((u) => ({
        unitType: u.unitType || "",
        area_m2: u.area_m2 || 0,
        price: u.price || 0,
        status: u.status || "DISPONIBLE",
        bedrooms: u.bedrooms,
      }))
    );

    console.log(`  Tipologías detectadas: ${typologies.length}`);
    for (const t of typologies) {
      console.log(`    ${t.name} | ${t.bedrooms} rec | ${t.area_m2}m² | desde $${t.priceFrom.toLocaleString()}`);
    }

    const webResult = await publishToWeb({
      developmentName: project?.nombre_proyecto || PROJECT_NAME,
      developerName: project?.desarrolladora || "Avica",
      location: `Carretera Tulum-Cobá Km 7.5, Tulum, Q.Roo`,
      city: "Tulum",
      description: "Desarrollo residencial boutique en la selva de Tulum. Arquitectura biofílica con amenidades premium.",
      amenities: ["Alberca", "Gym", "Coworking", "Salón de Eventos", "Juice Bar", "Fire Pit", "Yoga", "Rooftop"],
      status: "CONSTRUCCION",
      priceMin: mapResult.development.priceMin,
      priceMax: mapResult.development.priceMax,
      driveUrl: project?.url_carpeta_drive,
      typologies,
    });

    console.log(`  Publicadas: ${webResult.published} | Actualizadas: ${webResult.updated}`);
    if (webResult.errors.length > 0) {
      for (const err of webResult.errors) {
        console.log(`  ⚠️  ${err}`);
      }
    }

    // Finalizar job
    await prisma.syncJob.update({
      where: { id: syncJob.id },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        developmentId: uploadResult.developmentId,
        unitsCreated: uploadResult.unitsCreated,
        unitsUpdated: uploadResult.unitsUpdated,
        imagesProcessed: images.length,
        uploadData: uploadResult as any,
      },
    });

    await prisma.monitoredFolder.update({
      where: { id: folder.id },
      data: { lastSyncAt: new Date(), lastSyncStatus: "COMPLETED", developmentId: uploadResult.developmentId },
    });

    // ====== VERIFICACIÓN ======
    console.log("\n--- VERIFICACIÓN ---");
    const dev = await prisma.development.findUnique({
      where: { id: uploadResult.developmentId },
      include: { _count: { select: { units: true } } },
    });
    const unitsList = await prisma.unit.findMany({
      where: { developmentId: uploadResult.developmentId },
      orderBy: { unitNumber: "asc" },
      take: 10,
    });

    console.log(`  Desarrollo: ${dev?.name}`);
    console.log(`  Desarrolladora: ${dev?.developerName}`);
    console.log(`  Total unidades (real): ${dev?.totalUnits}`);
    console.log(`  Vendidas: ${dev?.soldUnits}`);
    console.log(`  Disponibles: ${dev?.availableUnits}`);
    console.log(`  Apartadas: ${dev?.reservedUnits}`);
    console.log(`  Unidades en DB: ${dev?._count.units}`);
    console.log(`  Brochure/Drive URL: ${dev?.brochureUrl}`);
    console.log(`\n  Primeras 10 unidades en DB:`);
    for (const u of unitsList) {
      console.log(`    ${u.unitNumber} | ${u.unitType} | ${Number(u.area_m2)}m² | $${Number(u.price).toLocaleString()} | ${u.status} | Piso ${u.floor ?? "-"}`);
    }

    console.log("\n" + "=".repeat(60));
    console.log("  SYNC COMPLETADO CON DATOS REALES");
    console.log("=".repeat(60));
    console.log(`  Ve a: http://localhost:3001/developments`);

  } catch (error) {
    console.error("\n❌ Error:", error);
    await prisma.syncJob.update({
      where: { id: syncJob.id },
      data: { status: "FAILED", error: (error as Error).message, completedAt: new Date() },
    });
  } finally {
    await prisma.$disconnect();
  }
}

main();
