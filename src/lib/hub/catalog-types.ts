// Tipos del catálogo PUBLICADO — espejo de lo que muestra propyte.com.
// Fuente de verdad: real_estate_hub.v_developments / v_units con el gate público
// (approved_at IS NOT NULL AND deleted_at IS NULL). El CRM no posee estos datos.

/** Toda lectura del catálogo distingue "vacío legítimo" de "no pude consultar". */
export interface CatalogResult<T> {
  data: T;
  error: string | null;
}

export interface PublishedDevelopment {
  id: string;
  slug: string | null;
  name: string;
  developerName: string | null;
  developmentType: string | null;
  stage: string | null;
  city: string | null;
  state: string | null;
  zone: string | null;
  priceMinMxn: number | null;
  priceMaxMxn: number | null;
  currency: string | null;
  totalUnits: number | null;
  availableUnits: number | null;
  reservedUnits: number | null;
  soldUnits: number | null;
  /** Unidades que realmente están publicadas en el sitio (gate aplicado). */
  publishedUnits: number;
  discountedUnitsCount: number | null;
  coverImage: string | null;
  estimatedDelivery: string | null;
  deliveryText: string | null;
  constructionProgress: number | null;
}

export interface PublishedDevelopmentDetail extends PublishedDevelopment {
  images: string[];
  amenities: string[];
  propertyTypes: string[];
  descriptionEs: string | null;
  descriptionShortEs: string | null;
  roiProjected: number | null;
  roiRentalMonthly: number | null;
  roiAppreciation: number | null;
  financingDownPayment: number | null;
  financingMonths: number[] | null;
  financingInterest: number | null;
  address: string | null;
  neighborhood: string | null;
  municipality: string | null;
  lat: number | null;
  lng: number | null;
  mapsUrl: string | null;
  beachDistance: string | null;
  brochureUrl: string | null;
  virtualTourUrl: string | null;
  masterplan: string | null;
  videoUrl: string | null;
  commissionRate: number | null;
  crmRelationship: string | null;
  contactName: string | null;
  contactPhone: string | null;
}

export interface PublishedUnit {
  id: string;
  slug: string | null;
  title: string | null;
  unitNumber: string | null;
  unitType: string | null;
  typology: string | null;
  status: string | null;
  isPresale: boolean | null;
  bedrooms: number | null;
  bathrooms: number | null;
  halfBaths: number | null;
  areaM2: number | null;
  builtAreaM2: number | null;
  priceMxn: number | null;
  priceUsd: number | null;
  currency: string | null;
  discountPriceMxn: number | null;
  discountPct: number | null;
  isDiscountActive: boolean | null;
  coverImage: string | null;
  developmentId: string | null;
  developmentName: string | null;
  developmentSlug: string | null;
  city: string | null;
  zone: string | null;
  // Esquemas de pago — lo que el agente IA hoy no puede responder
  finDirecto: boolean | null;
  finHipotecario: boolean | null;
  finEnganchePct: number | null;
  finMesesOpciones: number[] | null;
  finTasa: number | null;
  finEsquemasPago: unknown;
  // jsonb — objeto de esquema de preventa, NO un booleano
  finPreventa: unknown;
}

export interface DevelopmentCatalogFilters {
  search?: string | null;
  city?: string | null;
  zone?: string | null;
  stage?: string | null;
  priceMin?: number | null;
  priceMax?: number | null;
  onlyWithAvailable?: boolean;
  limit?: number;
}

export interface UnitCatalogFilters {
  developmentId?: string | null;
  search?: string | null;
  bedrooms?: number | null;
  priceMin?: number | null;
  priceMax?: number | null;
  zone?: string | null;
  limit?: number;
}

export interface CatalogSearchFilters {
  budgetMin?: number | null;
  budgetMax?: number | null;
  zone?: string | null;
  city?: string | null;
  bedrooms?: number | null;
  limit?: number;
}
