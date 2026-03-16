// ============================================================
// Web Publisher — Publica desarrollos en propyte-web
// Escribe directamente a properties.ts (datos estáticos)
// hasta que Supabase esté configurado
// ============================================================

import fs from "fs/promises";
import path from "path";

const PROPERTIES_FILE = path.resolve(process.cwd(), "../propyte-web/src/data/properties.ts");
const IMAGES_DIR = path.resolve(process.cwd(), "../propyte-web/public/img/desarrollos");

interface TypologyInput {
  name: string;
  bedrooms: number;
  bathrooms: number;
  area_m2: number;
  priceFrom: number;
  type: string;
  hasPool: boolean;
}

interface PublishInput {
  developmentName: string;
  developerName: string;
  location: string;
  city: string;
  description_es: string;
  description_en: string;
  amenities: string[];
  status: string;
  constructionProgress: number;
  deliveryYear: string;
  totalUnits: number;
  availableUnits: number;
  absorption: number;
  driveUrl?: string;
  typologies: TypologyInput[];
  imageFolder?: string; // Path local con imágenes
  driveImageUrls?: string[]; // URLs directas de Google Drive (lh3)
}

/**
 * Publica tipologías de un desarrollo en propyte-web/src/data/properties.ts
 * y copia las imágenes a public/img/desarrollos/
 */
export async function publishToWeb(input: PublishInput): Promise<{
  published: number;
  updated: number;
  urls: string[];
  errors: string[];
}> {
  const errors: string[] = [];
  const urls: string[] = [];
  let published = 0;
  let updated = 0;

  try {
    // 1. Verificar que properties.ts existe
    try {
      await fs.access(PROPERTIES_FILE);
    } catch {
      errors.push(`properties.ts no encontrado en ${PROPERTIES_FILE}`);
      return { published: 0, updated: 0, urls: [], errors };
    }

    // 2. Copiar imágenes si hay carpeta local
    const devSlug = slugify(input.developmentName);
    let imageFiles: string[] = [];

    if (input.imageFolder) {
      const destDir = path.join(IMAGES_DIR, devSlug);
      await fs.mkdir(destDir, { recursive: true });

      try {
        const files = await listImagesRecursive(input.imageFolder);
        for (const src of files) {
          const fileName = path.basename(src);
          const dest = path.join(destDir, fileName);
          try {
            await fs.access(dest);
          } catch {
            await fs.copyFile(src, dest);
          }
          imageFiles.push(`/img/desarrollos/${devSlug}/${fileName}`);
        }
      } catch (e) {
        errors.push(`Error copiando imágenes: ${(e as Error).message}`);
      }
    }

    // 3. Leer properties.ts actual
    let content = await fs.readFile(PROPERTIES_FILE, "utf-8");

    // 4. Generar entries para cada tipología
    const stageMap: Record<string, string> = {
      PREVENTA: "preventa",
      CONSTRUCCION: "construccion",
      ENTREGA_INMEDIATA: "entrega_inmediata",
    };
    const stage = stageMap[input.status] || "construccion";

    for (const typo of input.typologies) {
      const slug = slugify(`${input.developmentName}-${typo.name}`);
      const id = `sync-${slugify(input.developmentName)}-${slugify(typo.name)}`;

      // Verificar si ya existe
      if (content.includes(`slug: '${slug}'`)) {
        // Update: reemplazar precio
        const priceRegex = new RegExp(`(slug: '${slug}'[\\s\\S]*?price: \\{ mxn: )\\d+`, "m");
        content = content.replace(priceRegex, `$1${Math.round(typo.priceFrom)}`);

        // Update: reemplazar imágenes con Drive URLs si disponibles
        const updateImages = input.driveImageUrls && input.driveImageUrls.length > 0
          ? input.driveImageUrls.slice(0, 6)
          : assignImages(imageFiles, typo, input.developmentName);

        if (updateImages.length > 0) {
          const imgArrayStr = `[${updateImages.map((i) => `'${i}'`).join(", ")}]`;
          const imgRegex = new RegExp(`(slug: '${slug}'[\\s\\S]*?images: )\\[[^\\]]*\\]`, "m");
          content = content.replace(imgRegex, `$1${imgArrayStr}`);
        }

        updated++;
      } else {
        // Insert: agregar antes del cierre del array
        const propertyType = mapPropertyType(typo.type);
        let assignedImages = assignImages(imageFiles, typo, input.developmentName);
        // Fallback 1: Drive image URLs (directo del Drive sin descargar)
        if (assignedImages.length === 0 && input.driveImageUrls && input.driveImageUrls.length > 0) {
          assignedImages = input.driveImageUrls.slice(0, 6);
        }
        // Fallback 2: placeholder images
        if (assignedImages.length === 0) {
          assignedImages = [
            "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=800&h=450&fit=crop",
            "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=800&h=450&fit=crop",
            "https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=800&h=450&fit=crop",
            "https://images.unsplash.com/photo-1582268611958-ebfd161ef9cf?w=800&h=450&fit=crop",
          ];
        }

        const entry = generatePropertyEntry({
          id,
          slug,
          name: `${input.developmentName} — ${typo.name}`,
          developer: input.developerName,
          city: input.city,
          location: input.location,
          price: Math.round(typo.priceFrom),
          bedrooms: typo.bedrooms,
          bathrooms: typo.bathrooms,
          area: typo.area_m2,
          propertyType,
          stage,
          amenities: input.amenities,
          images: assignedImages,
          description_es: `${typo.name} de ${typo.area_m2} m² en ${input.developmentName}. ${input.description_es} ${input.constructionProgress}% avance. Entrega ${input.deliveryYear}. ${input.totalUnits} unidades, ${input.availableUnits} disponibles.`,
          description_en: `${typo.name} of ${typo.area_m2} sqm at ${input.developmentName}. ${input.description_en} ${input.constructionProgress}% progress. Delivery ${input.deliveryYear}.`,
          hasPool: typo.hasPool,
        });

        // Insertar antes de "];" al final del array
        content = content.replace(/\n\];\n\nexport function getAllProperties/, `\n${entry}\n];\n\nexport function getAllProperties`);
        published++;
      }

      urls.push(`/es/propiedades/${slug}`);
    }

    // 5. Escribir archivo actualizado
    await fs.writeFile(PROPERTIES_FILE, content, "utf-8");

  } catch (e) {
    errors.push(`Error general: ${(e as Error).message}`);
  }

  return { published, updated, urls, errors };
}

/**
 * Extrae tipologías únicas disponibles de las unidades del inventario.
 */
export function extractTypologies(units: Array<{
  unitType: string;
  area_m2: number;
  price: number;
  status: string;
  bedrooms?: number;
  extras?: string;
}>): TypologyInput[] {
  const groups = new Map<string, {
    name: string;
    count: number;
    bedrooms: number;
    areas: number[];
    prices: number[];
    type: string;
    hasPool: boolean;
  }>();

  for (const unit of units) {
    if (unit.status === "VENDIDA" || unit.status === "NO_DISPONIBLE") continue;
    if (!unit.price || unit.price === 0) continue;

    const key = unit.unitType || "UNKNOWN";
    const existing = groups.get(key);

    if (existing) {
      existing.count++;
      existing.areas.push(unit.area_m2);
      existing.prices.push(unit.price);
    } else {
      groups.set(key, {
        name: formatTypologyName(key),
        count: 1,
        bedrooms: unit.bedrooms || inferBedrooms(key),
        areas: [unit.area_m2],
        prices: [unit.price],
        type: key,
        hasPool: (unit.extras || "").toLowerCase().includes("alberca"),
      });
    }
  }

  return Array.from(groups.values()).map((g) => ({
    name: g.name,
    bedrooms: g.bedrooms,
    bathrooms: g.bedrooms >= 2 ? 2 : 1,
    area_m2: Math.round(g.areas.reduce((a, b) => a + b, 0) / g.areas.length * 100) / 100,
    priceFrom: Math.min(...g.prices),
    type: g.type,
    hasPool: g.hasPool,
  }));
}

// ---- Helpers ----

function generatePropertyEntry(p: {
  id: string; slug: string; name: string; developer: string;
  city: string; location: string; price: number;
  bedrooms: number; bathrooms: number; area: number;
  propertyType: string; stage: string; amenities: string[];
  images: string[]; description_es: string; description_en: string;
  hasPool: boolean;
}): string {
  const rentalMonthly = Math.round(p.price * 0.006); // ~0.6% mensual estimado
  const roi = p.price < 4_000_000 ? 12 : p.price < 6_000_000 ? 11 : 10;

  return `
  // ${p.name} (sync automático)
  {
    id: '${p.id}',
    slug: '${p.slug}',
    name: '${p.name.replace(/'/g, "\\'")}',
    developer: '${p.developer.replace(/'/g, "\\'")}',
    location: {
      city: '${p.city}',
      zone: '${p.location.split(",")[0].trim()}',
      state: 'Quintana Roo',
      lat: 20.2114,
      lng: -87.4654,
      address: '${p.location.replace(/'/g, "\\'")}',
    },
    price: { mxn: ${p.price}, currency: 'MXN' },
    specs: { bedrooms: ${p.bedrooms}, bathrooms: ${p.bathrooms}, area: ${p.area}, type: '${p.propertyType}' },
    stage: '${p.stage}',
    usage: ['vacacional', 'renta'],
    amenities: [${p.amenities.map((a) => `'${a.replace(/'/g, "\\'")}'`).join(", ")}],
    images: [${p.images.map((i) => `'${i}'`).join(", ")}],
    media: {},
    roi: { projected: ${roi}, rentalMonthly: ${rentalMonthly}, appreciation: ${roi - 1} },
    financing: { downPaymentMin: 30, months: [6, 12, 18, 24], interestRate: 0 },
    description: {
      es: '${p.description_es.replace(/'/g, "\\'")}',
      en: '${p.description_en.replace(/'/g, "\\'")}',
    },
    badge: 'nuevo',
    featured: true,
    createdAt: '${new Date().toISOString()}',
  },`;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function mapPropertyType(unitType: string): string {
  const upper = unitType.toUpperCase();
  if (upper.includes("PENTHOUSE") || upper.includes("PH")) return "penthouse";
  if (upper.includes("CASA") || upper.includes("VILLA")) return "casa";
  if (upper.includes("TERRENO") || upper.includes("LOTE")) return "terreno";
  if (upper.includes("MACROLOTE")) return "macrolote";
  return "departamento";
}

function formatTypologyName(unitType: string): string {
  return unitType
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/_/g, " ");
}

function inferBedrooms(unitType: string): number {
  const upper = unitType.toUpperCase();
  if (upper.includes("ESTUDIO") && !upper.includes("DOBLE") && !upper.includes("SUITE")) return 1;
  if (upper.includes("DOBLE") || upper.includes("SUITE")) return 2;
  if (upper.includes("2 REC") || upper.includes("LOCK")) return 2;
  if (upper.includes("3 REC") || upper.includes("CORNER")) return 3;
  return 1;
}

function assignImages(allImages: string[], typo: TypologyInput, devName: string): string[] {
  if (allImages.length === 0) return [];

  // Asignar imágenes relevantes por tipo
  const nameLower = typo.name.toLowerCase();
  const specific = allImages.filter((img) => {
    const imgLower = img.toLowerCase();
    if (nameLower.includes("pentgarden") && (imgLower.includes("pentgarden") || imgLower.includes("estudio"))) return true;
    if (nameLower.includes("lock") && (imgLower.includes("lock") || imgLower.includes("2-rec"))) return true;
    if (nameLower.includes("corner") && (imgLower.includes("corner") || imgLower.includes("3-rec"))) return true;
    if (nameLower.includes("penthouse") && (imgLower.includes("penthouse") || imgLower.includes("ph"))) return true;
    return false;
  });

  // Renders exteriores (compartidos)
  const exteriors = allImages.filter((img) => img.toLowerCase().includes("exterior") || img.toLowerCase().includes("00-"));
  const amenities = allImages.filter((img) => {
    const l = img.toLowerCase();
    return l.includes("gym") || l.includes("cowork") || l.includes("salon") || l.includes("alberca");
  });
  const photos = allImages.filter((img) => img.toLowerCase().includes("abril") || img.toLowerCase().includes("nativa-tulum"));

  // Combinar: exterior + específicas + amenidades + fotos (max 7)
  const combined = [...exteriors.slice(0, 1), ...specific.slice(0, 2), ...exteriors.slice(1, 2), ...amenities.slice(0, 1), ...photos.slice(0, 1)];
  const result = combined.filter((v, i, a) => a.indexOf(v) === i);
  return result.slice(0, 7);
}

async function listImagesRecursive(dirPath: string): Promise<string[]> {
  const results: string[] = [];
  const imageExts = new Set([".jpg", ".jpeg", ".png", ".webp"]);

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        const sub = await listImagesRecursive(fullPath);
        results.push(...sub);
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        if (imageExts.has(ext) && !entry.name.startsWith(".")) {
          results.push(fullPath);
        }
      }
    }
  } catch { /* ignore */ }

  return results;
}
