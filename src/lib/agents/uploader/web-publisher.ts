// ============================================================
// Web Publisher — Publica desarrollos en propyte-web via Supabase
// Upserts to the `developments` table so the website can render
// detail pages at /[locale]/desarrollos/[slug]
// ============================================================

import { getSupabaseServiceClient } from "@/lib/supabase";

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
  imageFolder?: string;
  driveImageUrls?: string[];
  // Extra metadata from redsearch CSV
  developerContact?: string;
  developerPhone?: string;
  commissionRate?: number;
  salesStartDate?: string;
  deliveryDate?: string;
  zone?: string;
}

/**
 * Publica/actualiza un desarrollo en Supabase `developments` table.
 * El sitio web (propyte-web) lee de esta tabla para generar páginas ISR.
 */
export async function publishToWeb(input: PublishInput): Promise<{
  published: number;
  updated: number;
  urls: string[];
  errors: string[];
}> {
  const errors: string[] = [];
  const urls: string[] = [];

  const supabase = getSupabaseServiceClient();
  if (!supabase) {
    errors.push("Supabase no configurado — SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY requeridos");
    return { published: 0, updated: 0, urls: [], errors };
  }

  try {
    const slug = slugify(input.developmentName);

    // Map status to development_stage enum
    const stageMap: Record<string, string> = {
      PREVENTA: "preventa",
      CONSTRUCCION: "construccion",
      ENTREGA_INMEDIATA: "entrega_inmediata",
    };
    const stage = stageMap[input.status] || "construccion";

    // Determine property types from typologies
    const propertyTypes = Array.from(new Set(
      input.typologies.map((t) => mapPropertyType(t.type))
    ));
    if (propertyTypes.length === 0) propertyTypes.push("departamento");

    // Calculate price range from typologies
    const prices = input.typologies.map((t) => t.priceFrom).filter((p) => p > 0);
    const priceMin = prices.length > 0 ? Math.min(...prices) : null;
    const priceMax = prices.length > 0 ? Math.max(...prices) : null;

    // Collect images
    let images: string[] = [];
    if (input.driveImageUrls && input.driveImageUrls.length > 0) {
      images = input.driveImageUrls.slice(0, 10);
    }
    // Fallback placeholder images
    if (images.length === 0) {
      images = [
        "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=800&h=450&fit=crop",
        "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=800&h=450&fit=crop",
      ];
    }

    // ROI estimates
    const roi = priceMin && priceMin < 4_000_000 ? 12 : priceMin && priceMin < 6_000_000 ? 11 : 10;
    const rentalMonthly = priceMin ? Math.round(priceMin * 0.006) : 0;

    // Build upsert data
    const devData: Record<string, unknown> = {
      slug,
      name: input.developmentName,
      city: input.city,
      zone: input.zone || input.location.split(",")[0].trim(),
      state: "Quintana Roo",
      address: input.location,
      stage,
      property_types: propertyTypes,
      price_min_mxn: priceMin,
      price_max_mxn: priceMax,
      total_units: input.totalUnits || null,
      available_units: input.availableUnits || null,
      sold_units: input.totalUnits && input.availableUnits ? input.totalUnits - input.availableUnits : null,
      roi_projected: roi,
      roi_rental_monthly: rentalMonthly > 0 ? Number((rentalMonthly / (priceMin || 1) * 100).toFixed(2)) : null,
      commission_rate: input.commissionRate || null,
      construction_progress: input.constructionProgress || 0,
      description_es: input.description_es,
      description_en: input.description_en,
      images,
      amenities: input.amenities,
      drive_url: input.driveUrl || null,
      contact_name: input.developerContact || null,
      contact_phone: input.developerPhone || null,
      usage: ["vacacional", "renta"],
      featured: false,
      published: true,
      updated_at: new Date().toISOString(),
    };

    // Parse delivery date
    if (input.deliveryDate) {
      try {
        const d = new Date(input.deliveryDate);
        if (!isNaN(d.getTime())) {
          devData.estimated_delivery = d.toISOString().split("T")[0];
          devData.delivery_text = input.deliveryDate;
        }
      } catch { /* ignore */ }
    }

    if (input.salesStartDate) {
      try {
        const d = new Date(input.salesStartDate);
        if (!isNaN(d.getTime())) {
          devData.sales_start_date = d.toISOString().split("T")[0];
        }
      } catch { /* ignore */ }
    }

    // Check if development exists
    const { data: existing } = await supabase
      .from("developments")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();

    if (existing) {
      // Update existing
      const { error } = await supabase
        .from("developments")
        .update(devData)
        .eq("id", existing.id);

      if (error) {
        errors.push(`Error actualizando ${slug}: ${error.message}`);
      } else {
        urls.push(`/es/desarrollos/${slug}`);
        return { published: 0, updated: 1, urls, errors };
      }
    } else {
      // Insert new
      const { error } = await supabase
        .from("developments")
        .insert(devData);

      if (error) {
        errors.push(`Error creando ${slug}: ${error.message}`);
      } else {
        urls.push(`/es/desarrollos/${slug}`);
        return { published: 1, updated: 0, urls, errors };
      }
    }
  } catch (e) {
    errors.push(`Error general: ${(e as Error).message}`);
  }

  return { published: 0, updated: 0, urls, errors };
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
  if (upper.includes("ESTUDIO") || upper.includes("STUDIO")) return "studio";
  if (upper.includes("TOWNHOUSE")) return "townhouse";
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
