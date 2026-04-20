/**
 * Tipos manuales de public.* (Felipe, READ-ONLY) y real_estate_hub.Propyte_*
 *
 * Mantener sincronizado con:
 *  - scripts/analyze-felipe-data.ts output
 *  - scripts/generated-real-estate-hub.sql
 *  - scripts/sql/robot_infra_0001.sql
 */

// ============================================================
// public.* schema de Felipe (READ-ONLY)
// ============================================================

export type PropertyStatus = "draft" | "review" | "published" | "possible_duplicate";
export type ListingType = "sale" | "presale" | "rent" | "<UNKNOWN>";
export type PropertyType =
  | "apartment"
  | "house"
  | "land"
  | "villa"
  | "office"
  | "penthouse"
  | "commercial"
  | "hotel"
  | "<UNKNOWN>";

/**
 * Espeja exactamente public.properties (36 columnas).
 * Los jsonb son `unknown` para forzar validacion por campo.
 */
export interface PublicProperty {
  id: string;
  source_id: string;
  source_listing_id: string;
  source_url: string;
  title: string;
  property_type: PropertyType;
  listing_type: ListingType;
  price_cents: bigint | null;
  currency: string; // 'USD' | 'MXN'
  bedrooms: number | null;
  bathrooms: number | null; // numeric
  construction_m2: number | null;
  land_m2: number | null;
  parking_spaces: number | null;
  developer_name: string | null;
  development_name: string | null;
  slug_adjective: string | null;
  country: string;
  state: string;
  city: string;
  neighborhood: string | null;
  address: string | null;
  postal_code: string | null;
  latitude: number | null;
  longitude: number | null;
  raw_data: Record<string, unknown>;
  extracted_data: Record<string, unknown>;
  content_es: ContentJsonb | null;
  content_en: ContentJsonb | null;
  content_fr: ContentJsonb | null;
  status: PropertyStatus;
  content_hash: string;
  first_seen_at: Date;
  last_seen_at: Date;
  last_crawl_run_id: string | null;
  published_at: Date | null;
}

/**
 * Estructura jsonb de content_es/en/fr (confirmada en analyze-published-sample 2026-04-13).
 * Felipe genera este contenido automaticamente al transicionar status -> published.
 */
export interface ContentJsonb {
  faq?: Array<{ question: string; answer: string }>;
  hero?: unknown;
  features?: unknown;
  location?: unknown;
  lifestyle?: unknown;
  metaTitle?: string;
  metaDescription?: string;
  contentVersion?: number | string;
  [key: string]: unknown;
}

/**
 * Espeja public.property_images (12 columnas).
 */
export interface PublicPropertyImage {
  id: string;
  property_id: string;
  position: number;
  original_url: string;
  raw_url: string | null;
  clean_url: string | null;
  alt_text: string | null;
  width: number | null;
  height: number | null;
  has_watermark_removed: boolean;
  watermark_removal_version: string | null;
  created_at: Date;
}

/**
 * Espeja public.sources (9 columnas).
 */
export interface PublicSource {
  id: string;
  domain: string;
  name: string;
  status: string;
  last_crawled_at: Date | null;
}

// ============================================================
// real_estate_hub.* schema (WRITE destino)
// ============================================================

/**
 * Subset relevante para Robot 1 de Propyte_desarrolladores.
 */
export interface PropyteDesarrollador {
  id: string;
  nombre_desarrollador: string;
  ext_slug_desarrollador: string | null;
  logo: string | null;
  sitio_web: string | null;
  descripcion: string | null;
  ext_descripcion_en: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

/**
 * Subset relevante para Robot 1 de Propyte_desarrollos.
 * (tabla completa tiene 111+ columnas, solo modelamos las que tocamos)
 */
export interface PropyteDesarrolloWrite {
  id?: string;
  legacy_id?: number | null;
  nombre_desarrollo: string;
  ext_slug_desarrollo?: string | null;
  tipo_desarrollo?: string | null;
  ext_precio_min_mxn?: number | null;
  ext_precio_max_mxn?: number | null;
  ext_moneda?: string | null;
  ext_descripcion_es?: string | null;
  ext_descripcion_en?: string | null;
  ext_descripcion_corta_es?: string | null;
  ext_descripcion_corta_en?: string | null;
  ext_meta_title_desarrollo?: string | null;
  ext_meta_description_desarrollo?: string | null;
  ext_content_es?: ContentJsonb | null;
  ext_content_en?: ContentJsonb | null;
  ext_content_fr?: ContentJsonb | null;
  ext_content_hashes?: Record<string, string> | null;
  ext_scraper_first_seen_at?: Date | null;
  ext_scraper_last_seen_at?: Date | null;
  ext_scraper_published_at?: Date | null;
  ext_google_maps_url?: string | null;
  pais?: string | null;
  estado?: string | null;
  municipio?: string | null;
  ciudad?: string | null;
  colonia?: string | null;
  latitud?: number | null;
  longitud?: number | null;
  id_desarrollador?: string | null;
  ext_detection_source?: string | null;
  ext_source_url?: string | null;
  ext_detected_at?: Date | null;
  ext_publicado?: boolean;
  // amenidades (16 bools — OR boolean sobre properties del grupo)
  amenidad_alberca_privada?: boolean;
  amenidad_alberca_comunitaria?: boolean;
  amenidad_gym?: boolean;
  amenidad_salon_eventos?: boolean;
  amenidad_coworking?: boolean;
  amenidad_rooftop?: boolean;
  amenidad_fire_pit?: boolean;
  amenidad_yoga?: boolean;
  amenidad_jardin_privado?: boolean;
  amenidad_jardin_comunitario?: boolean;
  amenidad_spa?: boolean;
  amenidad_restaurante?: boolean;
  amenidad_concierge?: boolean;
  amenidad_seguridad_24h?: boolean;
  amenidad_cctv?: boolean;
  amenidad_acceso_controlado?: boolean;
  amenidad_lobby?: boolean;
  amenidad_elevador?: boolean;
  amenidad_bodega?: boolean;
  amenidad_pet_zone?: boolean;
  amenidad_cancha?: boolean;
  amenidad_area_ninos?: boolean;
  amenidades_adicionales?: string[] | Record<string, unknown> | null;
}

/**
 * Subset relevante para Robot 1 de Propyte_unidades.
 */
export interface PropyteUnidadWrite {
  id?: string;
  legacy_id?: number | null;
  id_desarrollo?: string | null;
  id_desarrollador?: string | null;
  slug_unidad?: string | null;
  ext_numero_unidad?: string | null;
  ext_tipologia?: string | null;
  ext_precio_venta?: number | null;
  ext_descripcion_en?: string | null;
  descripcion_corta_unidad?: string | null;
  descripcion_larga_unidad?: string | null;
  meta_title_unidad?: string | null;
  meta_description_unidad?: string | null;
  ext_content_es?: ContentJsonb | null;
  ext_content_en?: ContentJsonb | null;
  ext_content_fr?: ContentJsonb | null;
  ext_content_hash?: string | null;
  ext_scraper_first_seen_at?: Date | null;
  ext_scraper_last_seen_at?: Date | null;
  ext_scraper_published_at?: Date | null;
  ext_source_url?: string | null;
  ext_detection_source?: string | null;
  ext_google_maps_url?: string | null;
  ext_legacy_property_id?: string | null; // UUID de public.properties.id (clave canonica)
  ext_publicado?: boolean;
  // atributos fisicos
  precio_mxn?: number | null;
  precio_usd?: number | null;
  recamaras?: number | null;
  banos_completos?: number | null;
  superficie_total_m2?: number | null;
  estacionamientos?: number | null;
  titulo_unidad?: string | null;
  estado_unidad?: string | null;
  // imagenes (llenado por Robot 2)
  fotos_unidad?: string[] | null;
  foto_portada_unidad?: string | null;
  // status de Felipe/mpgenesis (draft/review/possible_duplicate/published).
  // El trigger real_estate_hub.fn_recompute_dev_genesis_status lo propaga al padre.
  genesis_status?: string | null;
}

// ============================================================
// Robot_runs (observabilidad)
// ============================================================

export type RobotName =
  | "01-classifier"
  | "02-images"
  | "03-amenities"
  | "04-geo"
  | "05-ai-content";

export type RobotRunStatus = "running" | "success" | "failure" | "partial" | "dry_run";

export interface RobotRunRecord {
  id: string;
  robot_name: RobotName;
  started_at: Date;
  completed_at: Date | null;
  status: RobotRunStatus;
  inputs: Record<string, unknown> | null;
  outputs: Record<string, unknown> | null;
  errors: Array<Record<string, unknown>> | null;
  duration_ms: number | null;
  git_sha: string | null;
  host: string | null;
  created_at: Date;
}

// ============================================================
// FX rate (Banxico)
// ============================================================

export interface FxRate {
  source: "banxico" | "fallback";
  usdToMxn: number;
  date: string; // YYYY-MM-DD
  fetchedAt: Date;
}
