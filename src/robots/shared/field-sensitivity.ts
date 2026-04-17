/**
 * Clasificacion de campos NEUTRALES vs SENSIBLES.
 *
 * NEUTRALES: datos factuales que no revelan identidad de competidor.
 *   Seguros de leer desde cualquier status (draft/review/published).
 *
 * SENSIBLES: pueden contener branding/contacto de rivales.
 *   Solo leer desde status='published' (limpio por humano de Felipe).
 *   Si ninguna property del grupo esta published, el campo queda NULL
 *   (mejor vacio que contaminado con data de competencia).
 *
 * Ver insight en project_supabase_new.md y plan quirky-stargazing-reef.md.
 */

const NEUTRAL_FIELDS = new Set<string>([
  // clasificacion basica
  "property_type",
  "listing_type",
  // atributos fisicos
  "bedrooms",
  "bathrooms",
  "construction_m2",
  "land_m2",
  "parking_spaces",
  "year_built",
  // geo
  "latitude",
  "longitude",
  "country",
  "state",
  "city",
  "neighborhood",
  "postal_code",
  "address",
  // precio (la fuente no contamina, el monto es factual)
  "price_cents",
  "currency",
  "price_mxn",
  "price_usd",
  // amenities (factual)
  "amenities",
  "raw_data.amenities",
  // nombres de desarrollo (la marca DEL desarrollo, no del rival)
  "development_name",
  "nombre_desarrollo",
  // timestamps
  "first_seen_at",
  "last_seen_at",
  "published_at",
  "content_hash",
]);

const SENSITIVE_FIELDS = new Set<string>([
  // textos que pueden incluir branding/contacto rival
  "title",
  "description",
  "description_en",
  "description_fr",
  "raw_data.description",
  "raw_data.contact_phone",
  "raw_data.contact_whatsapp",
  "raw_data.contact_email",
  // identidad de contacto
  "developer_name",
  "nombre_desarrollador",
  "broker_name",
  "phone",
  "whatsapp",
  "email",
  "contacto_nombre",
  "contacto_telefono",
  // URLs (el dominio revela el rival)
  "source_url",
  "ext_source_url",
  "website_url",
  // imagenes (pueden tener watermark/logo rival)
  "property_images",
  "fotos_unidad",
  "fotos_desarrollo",
  "image",
  "raw_data.image",
  // contenido parafraseado/enriquecido
  "content_es",
  "content_en",
  "content_fr",
  "ext_content_es",
  "ext_content_en",
  "ext_content_fr",
]);

export const FIELD_SENSITIVITY = {
  isNeutral(field: string): boolean {
    return NEUTRAL_FIELDS.has(field);
  },
  isSensitive(field: string): boolean {
    return SENSITIVE_FIELDS.has(field);
  },
  /** Retorna lista para debug/logging */
  getAll(): { neutral: string[]; sensitive: string[] } {
    return {
      neutral: Array.from(NEUTRAL_FIELDS),
      sensitive: Array.from(SENSITIVE_FIELDS),
    };
  },
} as const;
