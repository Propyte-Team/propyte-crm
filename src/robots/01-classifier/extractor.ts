/**
 * Extractor: convierte un DevelopmentGroup en los payloads de upsert para
 * Propyte_desarrollos (1) + Propyte_unidades (N).
 *
 * Aplica reglas de:
 *  - tie-breaker sensitive vs neutral
 *  - agregacion MIN/MAX + OR amenities
 *  - dedup developers via pg_trgm
 *
 * NO ejecuta los UPSERTs — retorna payloads listos para el writer en run.ts.
 */

import { resolveDeveloper, getDevStats } from "./dedup-developers";
import { aggregatePrices, aggregateAmenities, pickByTieBreaker } from "./aggregators";
import { normalizePriceToMxn } from "../shared/fx";
import { sanitizeFaqs } from "../shared/developer-blacklist";

/**
 * Extrae un campo string de primer nivel del JSONB content.
 * Ej: extractField(content_es, "metaTitle") → "Depto 2 Recs Preventa..."
 */
function extractField(
  content: ContentJsonb | null | undefined,
  key: string
): string | null {
  if (!content) return null;
  const val = (content as Record<string, unknown>)[key];
  return typeof val === "string" && val.trim() ? val.trim() : null;
}

/**
 * Extrae un campo string de un sub-objeto del JSONB content.
 * Ej: extractNested(content_es, "hero", "intro") → "Descubre una nueva..."
 *     extractNested(content_es, "features", "body") → "Este departamento..."
 */
function extractNested(
  content: ContentJsonb | null | undefined,
  objectKey: string,
  fieldKey: string
): string | null {
  if (!content) return null;
  const obj = (content as Record<string, unknown>)[objectKey];
  if (!obj || typeof obj !== "object") return null;
  const val = (obj as Record<string, unknown>)[fieldKey];
  return typeof val === "string" && val.trim() ? val.trim() : null;
}
import type { DryRunContext } from "../shared/dry-run";
import type { DevelopmentGroup } from "./classifier";
import type {
  PropyteDesarrolloWrite,
  PropyteUnidadWrite,
  ContentJsonb,
  PublicProperty,
} from "../shared/types";

export interface ExtractedGroup {
  /** Key del grupo (nombre normalizado o __NO_DEV__) */
  groupKey: string;
  /** Payload del desarrollo, o null si grupo __NO_DEV__ (properties sueltas) */
  desarrollo: PropyteDesarrolloWrite | null;
  /** FK id_desarrollador (resuelto) compartido por todas las unidades */
  idDesarrollador: string | null;
  /** Payloads de las unidades (una por property) */
  unidades: PropyteUnidadWrite[];
  /** Metricas de extraccion */
  stats: {
    propertiesCount: number;
    publishedCount: number;
    reviewCount: number;
    amenitiesMatched: number;
    amenitiesUnmatched: number;
    developerMethod: string | null;
  };
}

type EnrichedProperty = PublicProperty & { source_domain: string };

/**
 * Extrae datos a nivel unidad desde una PublicProperty individual.
 */
async function extractUnidad(
  p: EnrichedProperty,
  idDesarrollo: string | null,
  idDesarrollador: string | null
): Promise<PropyteUnidadWrite> {
  const precioMxn = await normalizePriceToMxn(p.price_cents, p.currency);
  const precioUsd =
    p.currency?.toUpperCase() === "USD" && p.price_cents != null
      ? Number(p.price_cents) / 100
      : null;

  const isPublished = p.status === "published";

  // Descripciones/SEO: SENSITIVE (solo published)
  const sensitiveContentEs = isPublished ? p.content_es : null;
  const sensitiveContentEn = isPublished ? p.content_en : null;

  // FAQs: NEUTRAL (cualquier status — generadas por AI, no contienen branding rival)
  const faqsFromContent = p.content_es
    ? sanitizeFaqs((p.content_es as Record<string, unknown>).faq as any)
    : null;
  // Merge: contenido sensitive + FAQs neutrales
  const contentEs = buildMergedContent(sensitiveContentEs, faqsFromContent);
  const contentEn = sensitiveContentEn;

  const heroIntroEs = extractNested(contentEs, "hero", "intro");
  const heroIntroEn = extractNested(contentEn, "hero", "intro");
  const metaTitleEs = extractField(contentEs, "metaTitle");
  const metaDescEs = extractField(contentEs, "metaDescription");

  return {
    id_desarrollo: idDesarrollo,
    id_desarrollador: idDesarrollador,
    // titulo: metaTitle del content (NO nombre del desarrollo para evitar deteccion)
    titulo_unidad: metaTitleEs ?? (isPublished ? p.title : null),
    descripcion_larga_unidad: heroIntroEs,
    descripcion_corta_unidad: heroIntroEs ? heroIntroEs.slice(0, 250) : null,
    ext_descripcion_en: heroIntroEn,
    meta_title_unidad: metaTitleEs,
    meta_description_unidad: metaDescEs,
    // slug_unidad: NO setear desde scraper (slug_adjective de Felipe trae
    //   adjetivos repetidos como "privado", "de-lujo" que chocan con UNIQUE).
    //   Un humano debe asignar slug URL-safe al publicar.
    ext_content_es: contentEs, // JSONB con FAQs neutrales mergeadas
    ext_content_en: contentEn,
    ext_content_fr: isPublished ? p.content_fr : null,
    ext_content_hash: p.content_hash,
    ext_source_url: isPublished ? p.source_url : null, // SENSITIVE (revela rival domain)
    ext_legacy_property_id: p.id, // NEUTRAL - UUID, clave canonica de idempotencia
    ext_detection_source: "robot-01-classifier",
    ext_scraper_first_seen_at: p.first_seen_at,
    ext_scraper_last_seen_at: p.last_seen_at,
    ext_scraper_published_at: p.published_at,
    ext_publicado: false, // humano decide publicar despues
    precio_mxn: precioMxn,
    precio_usd: precioUsd,
    recamaras: p.bedrooms,
    banos_completos: p.bathrooms != null ? Math.floor(p.bathrooms) : null,
    superficie_total_m2: p.construction_m2,
    estacionamientos: p.parking_spaces,
    estado_unidad: mapListingTypeToStatus(p.listing_type),
    // ext_numero_unidad: NO setear desde slug_adjective (mismo problema)
    // genesis_status: el status de Felipe/mpgenesis (draft/review/possible_duplicate/published).
    // El trigger real_estate_hub.fn_recompute_dev_genesis_status propaga el "más avanzado"
    // de los genesis_status de las unidades hijas al Propyte_desarrollos padre.
    genesis_status: p.status,
  };
}

function mapListingTypeToStatus(t: PublicProperty["listing_type"]): string {
  switch (t) {
    case "sale":
      return "disponible";
    case "presale":
      return "preventa";
    case "rent":
      return "renta";
    default:
      return "disponible";
  }
}

// ─── NORMALIZACIÓN DE CIUDADES ────────────────────────────────
// Mapa de variantes conocidas → forma canónica.
// Resuelve: "Cancun"→"Cancún", "Playa Del Carmen"→"Playa del Carmen", etc.
const CITY_NORMALIZATION: Record<string, string> = {
  "cancun": "Cancún",
  "merida": "Mérida",
  "playa del carmen": "Playa del Carmen",
  "valladolid": "Valladolid",
  "tulum": "Tulum",
  "puerto morelos": "Puerto Morelos",
  "bacalar": "Bacalar",
  "cozumel": "Cozumel",
  "isla mujeres": "Isla Mujeres",
  "puerto aventuras": "Puerto Aventuras",
  "akumal": "Akumal",
  "mahahual": "Mahahual",
  "punta cana": "Punta Cana",
  "las terrenas": "Las Terrenas",
};

const STATE_NORMALIZATION: Record<string, string> = {
  "quintana roo": "Quintana Roo",
  "yucatan": "Yucatán",
  "la altagracia": "La Altagracia",
  "punta cana": "Punta Cana",
};

function normalizeCity(city: string | null): string | null {
  if (!city) return null;
  const key = city.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  return CITY_NORMALIZATION[key] ?? city.trim();
}

function normalizeState(state: string | null): string | null {
  if (!state) return null;
  const key = state.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  return STATE_NORMALIZATION[key] ?? state.trim();
}

/**
 * Extrae FAQs como campo NEUTRAL: se toman de cualquier status (review o published)
 * porque son generadas por AI (MPgenesis), no contienen branding rival.
 * Se sanitizan para remover menciones de brokers/agencias.
 */
function extractFaqsNeutral(
  properties: EnrichedProperty[]
): Array<{ question: string; answer: string }> | null {
  // Buscar la mejor propiedad que tenga FAQs (cualquier status)
  for (const p of properties) {
    const content = p.content_es;
    if (!content) continue;
    const faq = (content as Record<string, unknown>).faq;
    if (Array.isArray(faq) && faq.length > 0) {
      return sanitizeFaqs(faq as Array<{ question: string; answer: string }>);
    }
  }
  return null;
}

/**
 * Construye un content JSONB completo mezclando:
 *  - Descripciones/SEO del contenido SENSITIVE (solo published)
 *  - FAQs del contenido NEUTRAL (cualquier status, sanitizadas)
 */
function buildMergedContent(
  sensitiveContent: ContentJsonb | null,
  neutralFaqs: Array<{ question: string; answer: string }> | null
): ContentJsonb | null {
  if (!sensitiveContent && !neutralFaqs) return null;

  // Si hay contenido sensitive, mezclamos las FAQs neutrales
  if (sensitiveContent) {
    const merged = { ...sensitiveContent };
    if (neutralFaqs && neutralFaqs.length > 0) {
      (merged as Record<string, unknown>).faq = neutralFaqs;
    }
    return merged;
  }

  // Si solo hay FAQs neutrales sin contenido sensitive, creamos un JSONB mínimo
  if (neutralFaqs && neutralFaqs.length > 0) {
    return { faq: neutralFaqs } as unknown as ContentJsonb;
  }

  return null;
}

/**
 * Extrae datos a nivel desarrollo: agrega + tie-breaker sobre las properties del grupo.
 */
async function extractDesarrollo(
  group: DevelopmentGroup & { properties: EnrichedProperty[] },
  idDesarrollador: string | null
): Promise<PropyteDesarrolloWrite> {
  const { properties, displayName } = group;

  // Agregaciones
  const prices = await aggregatePrices(properties);
  const amenities = aggregateAmenities(properties);

  // Content jsonb (SENSITIVE — tie-breaker ya filtra por published)
  const contentEsSensitive = pickByTieBreaker<ContentJsonb | null>(
    properties,
    (p) => p.content_es,
    "content_es"
  );
  const contentEnSensitive = pickByTieBreaker<ContentJsonb | null>(
    properties,
    (p) => p.content_en,
    "content_en"
  );
  const contentFr = pickByTieBreaker<ContentJsonb | null>(
    properties,
    (p) => p.content_fr,
    "content_fr"
  );

  // FAQs (NEUTRAL — se toman de cualquier status, sanitizadas)
  const faqsEs = extractFaqsNeutral(properties);
  // Merge: contenido sensitive + FAQs neutrales
  const contentEs = buildMergedContent(contentEsSensitive, faqsEs);
  const contentEn = contentEnSensitive; // EN FAQs se toman del mismo content si existe

  // Geo (NEUTRAL) — con normalización de ciudades
  const latitud = pickByTieBreaker<number | null>(
    properties,
    (p) => p.latitude,
    "latitude"
  );
  const longitud = pickByTieBreaker<number | null>(
    properties,
    (p) => p.longitude,
    "longitude"
  );
  const estadoRaw = pickByTieBreaker<string | null>(
    properties,
    (p) => p.state ?? null,
    "state"
  );
  const municipioRaw = pickByTieBreaker<string | null>(
    properties,
    (p) => p.city ?? null,
    "city"
  );
  const colonia = pickByTieBreaker<string | null>(
    properties,
    (p) => p.neighborhood,
    "neighborhood"
  );

  // Normalizar ciudades y estados
  const estado = normalizeState(estadoRaw);
  const municipio = normalizeCity(municipioRaw);

  // Source URL del desarrollo (SENSITIVE — solo de published)
  const sourceUrl = pickByTieBreaker<string | null>(
    properties,
    (p) => p.source_url,
    "source_url"
  );

  // Timestamps: primera vista, ultima vista, mas reciente publicado
  const firstSeenAt = properties.reduce(
    (min, p) => (p.first_seen_at < min ? p.first_seen_at : min),
    properties[0].first_seen_at
  );
  const lastSeenAt = properties.reduce(
    (max, p) => (p.last_seen_at > max ? p.last_seen_at : max),
    properties[0].last_seen_at
  );
  const publishedAt = properties
    .filter((p) => p.published_at != null)
    .reduce<Date | null>((max, p) => (!max || p.published_at! > max ? p.published_at : max), null);

  // content_hashes jsonb: { property_id: content_hash } para deteccion de cambios
  const contentHashes: Record<string, string> = {};
  for (const p of properties) {
    contentHashes[p.id] = p.content_hash;
  }

  // Property types unicos del grupo (para ext_property_types array)
  const propertyTypesSet = new Set(properties.map((p) => p.property_type).filter(Boolean));

  // Extraer campos individuales del JSONB content → columnas TEXT separadas
  const heroIntroEs = extractNested(contentEs, "hero", "intro");
  const heroIntroEn = extractNested(contentEn, "hero", "intro");
  const metaTitleEs = extractField(contentEs, "metaTitle");
  const metaDescEs = extractField(contentEs, "metaDescription");

  return {
    nombre_desarrollo: displayName,
    id_desarrollador: idDesarrollador,
    tipo_desarrollo: properties[0].listing_type === "presale" ? "preventa" : "vertical",
    ext_precio_min_mxn: prices.minMxn,
    ext_precio_max_mxn: prices.maxMxn,
    ext_moneda: "MXN", // siempre guardamos en MXN normalizado
    // Contenido separado en columnas TEXT
    ext_descripcion_es: heroIntroEs,
    ext_descripcion_en: heroIntroEn,
    ext_descripcion_corta_es: heroIntroEs ? heroIntroEs.slice(0, 250) : null,
    ext_descripcion_corta_en: heroIntroEn ? heroIntroEn.slice(0, 250) : null,
    ext_meta_title_desarrollo: metaTitleEs,
    ext_meta_description_desarrollo: metaDescEs,
    // JSONB raw con FAQs neutrales mergeadas
    ext_content_es: contentEs,
    ext_content_en: contentEn,
    ext_content_fr: contentFr,
    ext_content_hashes: contentHashes,
    ext_scraper_first_seen_at: firstSeenAt,
    ext_scraper_last_seen_at: lastSeenAt,
    ext_scraper_published_at: publishedAt,
    pais: "Mexico",
    estado: estado,
    municipio: municipio,
    ciudad: municipio, // misma que municipio en mexico urbano
    colonia: colonia,
    latitud: latitud,
    longitud: longitud,
    ext_detection_source: "robot-01-classifier",
    ext_source_url: sourceUrl,
    ext_detected_at: new Date(),
    ext_publicado: false,
    ...amenities.booleans,
    amenidades_adicionales: amenities.additional.length > 0 ? amenities.additional : null,
  };
}

/**
 * Punto de entrada: extrae un DevelopmentGroup completo.
 */
export async function extractGroup(
  ctx: DryRunContext,
  group: DevelopmentGroup
): Promise<ExtractedGroup> {
  const propertiesEnriched = group.properties as EnrichedProperty[];

  // Resolver desarrollador: toma el developer_name mas confiable del grupo
  const devNameCandidate = pickByTieBreaker<string | null>(
    propertiesEnriched,
    (p) => p.developer_name,
    "developer_name"
  );

  const resolution = devNameCandidate
    ? await resolveDeveloper(ctx, devNameCandidate)
    : null;
  const idDesarrollador = resolution?.id ?? null;

  // Stats de status distribution
  const publishedCount = propertiesEnriched.filter((p) => p.status === "published").length;
  const reviewCount = propertiesEnriched.filter((p) => p.status === "review").length;

  const stats: ExtractedGroup["stats"] = {
    propertiesCount: propertiesEnriched.length,
    publishedCount,
    reviewCount,
    amenitiesMatched: 0,
    amenitiesUnmatched: 0,
    developerMethod: resolution?.method ?? null,
  };

  // Extraer desarrollo (salvo grupo __NO_DEV__)
  let desarrollo: PropyteDesarrolloWrite | null = null;
  let idDesarrollo: string | null = null;

  if (group.key !== "__NO_DEV__") {
    desarrollo = await extractDesarrollo(
      { ...group, properties: propertiesEnriched },
      idDesarrollador
    );
    // Para las unidades necesitamos el id del desarrollo, pero aun no existe
    // (lo crea el writer en run.ts). Usamos null aqui y el writer lo resuelve
    // despues de hacer el upsert del desarrollo.
  }

  // Extraer unidades (una por property)
  const unidades: PropyteUnidadWrite[] = [];
  for (const p of propertiesEnriched) {
    unidades.push(await extractUnidad(p, idDesarrollo, idDesarrollador));
  }

  // Popular amenities stats desde aggregateAmenities (re-run barato)
  const amenAgg = aggregateAmenities(propertiesEnriched);
  stats.amenitiesMatched = amenAgg.totalMatched;
  stats.amenitiesUnmatched = amenAgg.totalUnmatched;

  return {
    groupKey: group.key,
    desarrollo,
    idDesarrollador,
    unidades,
    stats,
  };
}
