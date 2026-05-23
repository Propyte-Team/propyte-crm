// ============================================================
// Field Mappings: Supabase ↔ Zoho CRM
// Refactor 2026-05-22 — Fase 6:
//   - Mapeo canónico alineado con los 133 fields creados en prod
//     (manifest Propyte_hub/docs/zoho-backups/2026-05-22-sandbox-final/).
//   - REGLA DURA 1: Zoho ↔ columnas FLAT de Migration 022
//     (content_features_es/en, content_location_es/en, content_lifestyle_es/en).
//     NUNCA escribir/leer `ext_content_es/en` JSONB desde Zoho.
//   - REGLA DURA 2: FAQs son Hub-only (faq_es / faq_en jsonb), no se sincronizan.
//   - REGLA DURA 3: No escribir a `Bedrooms` / `Ba_os_completos` nuevos.
//     Los antiguos `Rec_maras` / `Ba_os` (TEXT) son canónicos por decisión Luis
//     (workflows Zoho los referencian).
//   - REGLA DURA 4: amenidades (24 columnas bool en Supabase) se traducen a
//     multiselect `Amenidades` solo cuando hay un mapping limpio definido.
//     Hasta que Luis confirme picklist values, se omite.
// ============================================================

import type {
  ZohoProyectoInmobiliario,
  ZohoProduct,
  ZohoLead,
  ZohoDeal,
  ZohoAccount,
  ZohoRecord,
  PipelineStatus,
} from "./types";

// ============================================================
// 1. Tipos de mapping
// ============================================================

type Transform =
  | "first_array_item"
  | "to_string"
  | "to_number"
  | "to_integer"
  | "to_boolean"
  | "to_date"
  | "lookup_id";

interface FieldMapping {
  supabase: string;
  zoho: string;
  transform?: Transform;
}

function applyTransform(value: unknown, transform?: Transform): unknown {
  if (value == null) return null;
  switch (transform) {
    case "first_array_item":
      return Array.isArray(value) ? value[0] ?? null : value;
    case "to_string":
      return String(value);
    case "to_number":
      return Number(value) || null;
    case "to_integer": {
      const n = Number(value);
      return Number.isFinite(n) ? Math.trunc(n) : null;
    }
    case "to_boolean":
      return Boolean(value);
    case "to_date":
      // Espera ISO o YYYY-MM-DD. Zoho `date` quiere YYYY-MM-DD.
      if (value instanceof Date) return value.toISOString().slice(0, 10);
      if (typeof value === "string") return value.slice(0, 10);
      return null;
    default:
      return value;
  }
}

function mapRecord<T extends Record<string, unknown>>(
  source: Record<string, unknown>,
  mappings: FieldMapping[]
): T {
  const out: Record<string, unknown> = {};
  for (const m of mappings) {
    const value = source[m.supabase];
    if (value == null) continue;
    const transformed = applyTransform(value, m.transform);
    if (transformed == null) continue;
    out[m.zoho] = transformed;
  }
  return out as T;
}

function normalizePipelineStatus(
  value: unknown
): PipelineStatus | undefined {
  if (typeof value !== "string") return undefined;
  if (["Borrador", "Revision", "Publicado", "Rechazado", "Terminado"].includes(value)) {
    return value as PipelineStatus;
  }
  return undefined;
}

// ============================================================
// 2. Hub → Zoho mappings (Propyte_desarrollos → Proyectos_Inmobiliarios)
// ============================================================

const DEVELOPMENT_FIELDS: FieldMapping[] = [
  // Identidad / SEO
  { supabase: "nombre_desarrollo", zoho: "Name" },
  { supabase: "ext_slug_desarrollo", zoho: "Slug_URL" },
  { supabase: "ext_meta_title_desarrollo", zoho: "Meta_t_tulo" },
  { supabase: "ext_meta_description_desarrollo", zoho: "Meta_descripci_n" },

  // Pipeline (set explícitamente abajo)

  // Editoriales ES — REGLA DURA: columnas FLAT, NO ext_content_es JSONB.
  // Solo ES (decisión Luis 2026-05-23). Zoho no tiene fields _EN ni _FR.
  { supabase: "ext_descripcion_es", zoho: "Descripci_n_ES" },
  { supabase: "ext_descripcion_corta_es", zoho: "Descripci_n_corta_ES" },
  { supabase: "content_features_es", zoho: "Contenido_caracter_ES" },
  { supabase: "content_location_es", zoho: "Contenido_ubicaci_n_ES" },
  { supabase: "content_lifestyle_es", zoho: "Contenido_lifestyle_ES" },

  // Construcción / fases
  { supabase: "tipo_desarrollo", zoho: "Tipo_desarrollo" },
  { supabase: "etapa_construccion", zoho: "Etapa_construcci_n" },
  { supabase: "avance_obra_porcentaje", zoho: "Avance_obra", transform: "to_number" },
  { supabase: "fecha_entrega", zoho: "Fecha_entrega", transform: "to_date" },
  { supabase: "unidades_totales", zoho: "Unidades_totales", transform: "to_integer" },
  { supabase: "ext_reserved_units", zoho: "Unidades_reservadas", transform: "to_integer" },
  { supabase: "ext_sold_units", zoho: "Unidades_vendidas", transform: "to_integer" },
  { supabase: "fases_totales", zoho: "Fases_totales", transform: "to_integer" },
  { supabase: "fase_actual", zoho: "Fase_actual", transform: "to_integer" },
  { supabase: "arquitecto", zoho: "Arquitecto" },
  { supabase: "concepto_diseno", zoho: "Concepto_dise_o" },

  // Pricing / ROI / financing
  { supabase: "ext_precio_min_mxn", zoho: "Precio_m_nimo_MXN", transform: "to_number" },
  { supabase: "ext_precio_max_mxn", zoho: "Precio_m_ximo_MXN", transform: "to_number" },
  { supabase: "ext_roi_proyectado", zoho: "ROI_proyectado", transform: "to_number" },
  { supabase: "ext_roi_renta_mensual", zoho: "ROI_renta_mensual", transform: "to_number" },
  { supabase: "ext_roi_apreciacion", zoho: "ROI_apreciaci_n", transform: "to_number" },
  { supabase: "ext_enganche_porcentaje", zoho: "Enganche_desarrollo", transform: "to_number" },
  { supabase: "ext_tasa_interes", zoho: "Tasa_inter_s_anual", transform: "to_number" },

  // Flags
  { supabase: "ext_destacado", zoho: "Es_destacado", transform: "to_boolean" },
  { supabase: "ext_publicado", zoho: "Publicado", transform: "to_boolean" },

  // URLs / multimedia
  { supabase: "foto_portada", zoho: "Cover_image_URL" },
  { supabase: "url_drive_general", zoho: "Drive_URL" },
  { supabase: "lista_precios", zoho: "Lista_precios_URL" },
  { supabase: "brochure_pdf", zoho: "Brochure_URL" },
  { supabase: "tour_virtual_desarrollo", zoho: "Virtual_tour_URL" },
  { supabase: "masterplan", zoho: "Masterplan_URL" },
  { supabase: "video_desarrollo", zoho: "Video_URL" },
  { supabase: "ext_source_url", zoho: "Source_URL" },

  // Ubicación — Zoho usa struct Direcci_n_* (los campos planos Domicilio,
  // Colonia, Estado, Municipio, Pa_s, C_digo_Postal NO EXISTEN en Zoho prod
  // 2026-05-23, se ignoraban silenciosamente).
  { supabase: "calle", zoho: "Direcci_n_Street_Address" },
  { supabase: "municipio", zoho: "Direcci_n_City" },
  { supabase: "estado", zoho: "Direcci_n_State_Province" },
  { supabase: "pais", zoho: "Direcci_n_Country_Region" },
  { supabase: "codigo_postal", zoho: "Direcci_n_Zip_Postal_Code" },
  { supabase: "latitud", zoho: "Direcci_n_Coordinates_Latitude", transform: "to_number" },
  { supabase: "longitud", zoho: "Direcci_n_Coordinates_Longitude", transform: "to_number" },
  { supabase: "zona", zoho: "Zona" },
  { supabase: "ext_google_maps_url", zoho: "Maps_URL" },
  { supabase: "playa_distancia", zoho: "Playa_distancia" },
  { supabase: "aeropuerto_nombre", zoho: "Aeropuerto_nombre" },
  { supabase: "aeropuerto_distancia", zoho: "Aeropuerto_distancia" },

  // Comerciales
  { supabase: "ext_commission_rate", zoho: "Comisi_n", transform: "to_number" },
  { supabase: "ext_plaza", zoho: "Plaza" },
  { supabase: "ext_badge", zoho: "Badge" },
];

// Mapping amenidades booleanas Supabase → Zoho multiselect Amenidades.
// Labels canónicos = Hub UI (fields-config.ts) con aliases hacia los display
// values reales de Zoho prod 2026-05-23 (Gimnasio/Yoga / Meditación/etc).
const DEVELOPMENT_AMENIDADES_MAP: Array<[string, string]> = [
  ["amenidad_alberca_privada", "Alberca privada"],
  ["amenidad_alberca_comunitaria", "Alberca comunitaria"],
  ["amenidad_gym", "Gimnasio"],
  ["amenidad_spa", "Spa"],
  ["amenidad_rooftop", "Rooftop"],
  ["amenidad_salon_eventos", "Salón de eventos"],
  ["amenidad_coworking", "Coworking"],
  ["amenidad_yoga", "Yoga / Meditación"],
  ["amenidad_fire_pit", "Fire pit"],
  ["amenidad_jardin_privado", "Jardín privado"],
  ["amenidad_jardin_comunitario", "Jardín comunitario"],
  ["amenidad_restaurante", "Restaurante"],
  ["amenidad_concierge", "Concierge"],
  ["amenidad_seguridad_24h", "Seguridad 24h"],
  ["amenidad_cctv", "CCTV"],
  ["amenidad_acceso_controlado", "Acceso controlado"],
  ["amenidad_lobby", "Lobby"],
  ["amenidad_elevador", "Elevador"],
  ["amenidad_bodega", "Bodega"],
  ["amenidad_pet_zone", "Área mascotas"],
  ["amenidad_cancha", "Cancha pádel/tenis"],
  ["amenidad_area_ninos", "Área niños"],
  ["ext_amenidad_juice_bar", "Juice/Snack bar"],
  ["ext_amenidad_service_room", "Cuarto servicio"],
];

export function developmentToZoho(
  dev: Record<string, unknown>
): ZohoProyectoInmobiliario {
  const record = mapRecord<ZohoProyectoInmobiliario>(dev, DEVELOPMENT_FIELDS);

  // Pipeline status — siempre incluir si está seteado
  const status = normalizePipelineStatus(dev.pipeline_status);
  if (status) record.Pipeline_Status = status;

  // Keywords SEO — array → CSV
  if (Array.isArray(dev.ext_keywords) && dev.ext_keywords.length > 0) {
    record.Keywords_SEO = (dev.ext_keywords as string[]).join(", ");
  }

  // Tipos de propiedad (multiselect)
  if (Array.isArray(dev.ext_property_types) && dev.ext_property_types.length > 0) {
    record.Tipos_propiedad = dev.ext_property_types as string[];
  }

  // Amenidades booleanas → Zoho multiselect
  const amenidades: string[] = [];
  for (const [col, zohoLabel] of DEVELOPMENT_AMENIDADES_MAP) {
    if (dev[col] === true) amenidades.push(zohoLabel);
  }
  if (amenidades.length > 0) record.Amenidades = amenidades;

  // Foto portada — fallback al primer item del array
  if (!record.Cover_image_URL && Array.isArray(dev.fotos_desarrollo) && dev.fotos_desarrollo.length > 0) {
    record.Cover_image_URL = String(dev.fotos_desarrollo[0]);
  }

  return record;
}

// ============================================================
// 3. Hub → Zoho mappings (Propyte_unidades → Products)
// ============================================================

const UNIT_FIELDS: FieldMapping[] = [
  // Identidad / SEO
  { supabase: "slug_unidad", zoho: "Slug_URL" },
  { supabase: "subtitulo_unidad", zoho: "Subt_tulo" },
  { supabase: "meta_title_unidad", zoho: "Meta_t_tulo" },
  { supabase: "meta_description_unidad", zoho: "Meta_descripci_n" },

  // Estado de la unidad (legacy preservado)
  { supabase: "estado_unidad", zoho: "Estado_de_la_unidad" },

  // Editoriales — REGLA DURA columnas FLAT
  { supabase: "descripcion_corta_unidad", zoho: "Descripci_n_corta" },
  { supabase: "descripcion_larga_unidad", zoho: "Descripci_n_larga" },
  { supabase: "content_features_es", zoho: "Contenido_caracter_ES" },
  { supabase: "content_location_es", zoho: "Contenido_ubicaci_n_ES" },
  { supabase: "content_lifestyle_es", zoho: "Contenido_lifestyle_ES" },

  // Dimensiones — Rec_maras y Ba_os son TEXT por decisión Luis.
  // Metros_Cuadrados_Totales es FÓRMULA en Zoho (readonly). Se calcula
  // automáticamente de Interior+Exterior. NO mapear.
  { supabase: "superficie_construida_m2", zoho: "Metros_cuadrados_Interior", transform: "to_number" },
  { supabase: "superficie_terreno_m2", zoho: "Metros_cuadrados_Exterior", transform: "to_number" },
  { supabase: "banos_completos", zoho: "Ba_os", transform: "to_string" },
  { supabase: "recamaras", zoho: "Rec_maras", transform: "to_string" },
  { supabase: "medios_banos", zoho: "Medios_ba_os", transform: "to_integer" },
  { supabase: "niveles_unidad", zoho: "Niveles", transform: "to_integer" },
  { supabase: "piso_numero", zoho: "Piso", transform: "to_integer" },
  { supabase: "estacionamientos", zoho: "Cajones_de_estacionamiento", transform: "to_integer" },
  { supabase: "ext_tipologia", zoho: "Tipolog_a" },

  // Pricing
  { supabase: "precio_mxn", zoho: "Unit_Price", transform: "to_number" },
  { supabase: "precio_usd", zoho: "Precio_USD", transform: "to_number" },
  { supabase: "precio_m2_mxn", zoho: "Precio_m2_MXN", transform: "to_number" },
  { supabase: "precio_m2_usd", zoho: "Precio_m2_USD", transform: "to_number" },
  { supabase: "precio_desde", zoho: "Precio_desde", transform: "to_number" },
  { supabase: "ext_precio_venta", zoho: "Precio_llave_en_mano", transform: "to_number" },
  { supabase: "moneda_principal", zoho: "Moneda_principal" },

  // Financiamiento
  { supabase: "enganche_porcentaje", zoho: "Enganche", transform: "to_number" },
  { supabase: "ext_enganche_mxn", zoho: "Enganche_MXN", transform: "to_number" },
  { supabase: "ext_mensualidad_mxn", zoho: "Mensualidad_MXN", transform: "to_number" },
  { supabase: "ext_tasa_interes", zoho: "Tasa_inter_s_anual", transform: "to_number" },
  { supabase: "ext_esquema_pago", zoho: "Esquema_de_pago" },
  { supabase: "financiamiento_directo", zoho: "Financiamiento_directo", transform: "to_boolean" },
  { supabase: "acepta_hipotecario", zoho: "Acepta_hipotecario", transform: "to_boolean" },
  { supabase: "acepta_infonavit", zoho: "Acepta_INFONAVIT", transform: "to_boolean" },
  { supabase: "ext_acepta_fovissste", zoho: "Acepta_FOVISSSTE", transform: "to_boolean" },

  // ROI
  { supabase: "roi_anual_porcentaje", zoho: "ROI_Anual", transform: "to_number" },
  { supabase: "renta_mensual_estimada_mxn", zoho: "Renta_mensual_MXN", transform: "to_number" },
  { supabase: "apreciacion_anual_porcentaje", zoho: "Apreciaci_n_anual", transform: "to_number" },
  { supabase: "tipo_rendimiento", zoho: "Tipo_rendimiento" },

  // Tipo / clasificación
  { supabase: "tipo_unidad", zoho: "Tipo_unidad" },
  { supabase: "subtipo_unidad", zoho: "Subtipo_unidad" },
  { supabase: "orientacion", zoho: "Orientaci_n" },
  { supabase: "vista_unidad", zoho: "Vista_unidad" },
  { supabase: "tipo_entrega", zoho: "Tipo_entrega" },
  { supabase: "regimen_propiedad", zoho: "R_gimen_propiedad" },
  { supabase: "uso_suelo_unidad", zoho: "Uso_de_suelo" },

  // Flags
  { supabase: "es_destacada_unidad", zoho: "Es_destacada", transform: "to_boolean" },
  { supabase: "es_preventa", zoho: "Es_preventa", transform: "to_boolean" },
  { supabase: "es_nueva_unidad", zoho: "Es_nueva", transform: "to_boolean" },
  { supabase: "amueblado", zoho: "Amueblado", transform: "to_boolean" },
  { supabase: "equipado", zoho: "Equipado", transform: "to_boolean" },
  { supabase: "mascotas_permitidas", zoho: "Mascotas_permitidas", transform: "to_boolean" },
  { supabase: "ext_tiene_alberca", zoho: "Tiene_alberca", transform: "to_boolean" },

  // Documentación legal
  { supabase: "escritura_disponible", zoho: "Escritura_disponible", transform: "to_boolean" },
  { supabase: "licencia_construccion", zoho: "Licencia_construcci_n", transform: "to_boolean" },
  { supabase: "ext_predial_vigente", zoho: "Predial_al_corriente", transform: "to_boolean" },
  { supabase: "ext_cert_libertad_gravamen", zoho: "Cert_lib_gravamen", transform: "to_boolean" },
  { supabase: "fideicomiso_requerido", zoho: "Fideicomiso_requerido", transform: "to_boolean" },
  { supabase: "ext_url_doc_uso_suelo", zoho: "Doc_uso_suelo_URL" },

  // URLs / multimedia
  { supabase: "foto_portada_unidad", zoho: "Cover_image_URL" },
  { supabase: "tour_virtual_unidad", zoho: "Virtual_tour_URL" },
  { supabase: "plano_unidad", zoho: "Floor_plan_URL" },
  { supabase: "video_recorrido_unidad", zoho: "Video_URL" },
];

export function unitToZoho(
  unit: Record<string, unknown>,
  parentZohoId: string | null
): ZohoProduct {
  const record = mapRecord<ZohoProduct>(unit, UNIT_FIELDS);

  // Product_Name = título publicado, slug o número
  record.Product_Name =
    (unit.titulo_unidad as string) ||
    (unit.slug_unidad as string) ||
    (unit.ext_numero_unidad as string) ||
    `Unidad ${unit.id}`;

  // Lookup al proyecto padre (Proyecto_inmobiliario legacy + Desarrollo nuevo)
  if (parentZohoId) {
    record.Proyecto_inmobiliario = { id: parentZohoId };
    record.Desarrollo = { id: parentZohoId };
  }

  // Pipeline status
  const status = normalizePipelineStatus(unit.pipeline_status);
  if (status) record.Pipeline_Status = status;

  // Keywords SEO
  if (Array.isArray(unit.keywords_unidad) && unit.keywords_unidad.length > 0) {
    record.Keywords_SEO = (unit.keywords_unidad as string[]).join(", ");
  }

  // Alberca legacy: bool → picklist Si/No (Zoho usa "Si" SIN tilde)
  if (unit.ext_tiene_alberca === true) {
    record.Alberca = "Si";
  } else if (unit.ext_tiene_alberca === false) {
    record.Alberca = "No";
  }

  // Cover image fallback al primer foto
  if (!record.Cover_image_URL && Array.isArray(unit.fotos_unidad) && unit.fotos_unidad.length > 0) {
    record.Cover_image_URL = String(unit.fotos_unidad[0]);
  }

  return record;
}

// ============================================================
// 4. Hub → Zoho mappings (Propyte_desarrolladores → Accounts)
// ============================================================

const DEVELOPER_FIELDS: FieldMapping[] = [
  { supabase: "nombre_desarrollador", zoho: "Account_Name" },
  { supabase: "ext_slug_desarrollador", zoho: "Slug_URL" },
  { supabase: "telefono", zoho: "Phone" },
  { supabase: "sitio_web", zoho: "Website" },
  { supabase: "logo_url", zoho: "Logo_URL" },
  { supabase: "descripcion_es", zoho: "Descripci_n_ES" },
  { supabase: "descripcion_es", zoho: "Description" },
  { supabase: "ciudad", zoho: "Billing_City" },
  { supabase: "estado", zoho: "Billing_State" },
  { supabase: "pais", zoho: "Billing_Country" },
  { supabase: "contacto_nombre", zoho: "Nombre_contacto" },
  { supabase: "contacto_puesto", zoho: "Puesto_contacto" },
  { supabase: "redes_sociales", zoho: "Redes_sociales" },
  { supabase: "verificado", zoho: "Es_verificado", transform: "to_boolean" },
  { supabase: "rating", zoho: "Rating_estrellas", transform: "to_number" },
  { supabase: "proyectos_activos", zoho: "Proyectos_activos", transform: "to_integer" },
  { supabase: "proyectos_entregados", zoho: "Proyectos_entregados", transform: "to_integer" },
  { supabase: "unidades_entregadas", zoho: "Unidades_entregadas", transform: "to_integer" },
  { supabase: "anios_experiencia", zoho: "A_os_experiencia", transform: "to_integer" },
  { supabase: "rfc", zoho: "RFC" },
  { supabase: "razon_social", zoho: "Raz_n_social" },
  { supabase: "latitud", zoho: "Latitud", transform: "to_number" },
  { supabase: "longitud", zoho: "Longitud", transform: "to_number" },
  { supabase: "zona", zoho: "Zona" },
  { supabase: "link_maps", zoho: "Link_maps" },
  { supabase: "master_broker", zoho: "Master_Broker", transform: "to_boolean" },
];

export function developerToZoho(
  dev: Record<string, unknown>
): ZohoAccount {
  const record = mapRecord<ZohoAccount>(dev, DEVELOPER_FIELDS);
  record.Industry = (dev.industry as string) || "Desarrolladora";
  return record;
}

// ============================================================
// 5. Zoho → Hub transformers (entidades inmobiliarias)
//    Para Fase 7 webhook + sync inicial cuando asesor crea en Zoho.
//    REGLA DURA: escribir a columnas FLAT, NUNCA a ext_content_es JSONB.
// ============================================================

/** Lee un campo Zoho con tolerancia a `null`/`undefined`/`""` */
function pick<T = unknown>(record: ZohoRecord, key: string): T | null {
  const v = record[key];
  if (v == null || v === "") return null;
  return v as T;
}

export function zohoProyectoToSupabase(
  record: ZohoProyectoInmobiliario
): Record<string, unknown> {
  return {
    zoho_record_id: record.id,
    nombre_desarrollo: pick<string>(record, "Name"),
    ext_slug_desarrollo: pick<string>(record, "Slug_URL"),
    ext_meta_title_desarrollo: pick<string>(record, "Meta_t_tulo"),
    ext_meta_description_desarrollo: pick<string>(record, "Meta_descripci_n"),
    ext_keywords:
      typeof record.Keywords_SEO === "string" && record.Keywords_SEO
        ? record.Keywords_SEO.split(",").map((s) => s.trim()).filter(Boolean)
        : null,

    pipeline_status: normalizePipelineStatus(record.Pipeline_Status) ?? null,

    // REGLA DURA: a columnas FLAT, no JSONB
    ext_descripcion_es: pick<string>(record, "Descripci_n_ES"),
    ext_descripcion_corta_es: pick<string>(record, "Descripci_n_corta_ES"),
    content_features_es: pick<string>(record, "Contenido_caracter_ES"),
    content_location_es: pick<string>(record, "Contenido_ubicaci_n_ES"),
    content_lifestyle_es: pick<string>(record, "Contenido_lifestyle_ES"),

    tipo_desarrollo: pick<string>(record, "Tipo_desarrollo"),
    etapa_construccion: pick<string>(record, "Etapa_construcci_n"),
    avance_obra_porcentaje: numOrNull(record.Avance_obra),
    fecha_entrega: pick<string>(record, "Fecha_entrega"),
    unidades_totales: numOrNull(record.Unidades_totales),
    ext_reserved_units: numOrNull(record.Unidades_reservadas),
    ext_sold_units: numOrNull(record.Unidades_vendidas),
    fases_totales: numOrNull(record.Fases_totales),
    fase_actual: numOrNull(record.Fase_actual),
    arquitecto: pick<string>(record, "Arquitecto"),
    concepto_diseno: pick<string>(record, "Concepto_dise_o"),

    ext_precio_min_mxn: numOrNull(record.Precio_m_nimo_MXN),
    ext_precio_max_mxn: numOrNull(record.Precio_m_ximo_MXN),
    ext_roi_proyectado: numOrNull(record.ROI_proyectado),
    ext_roi_renta_mensual: numOrNull(record.ROI_renta_mensual),
    ext_roi_apreciacion: numOrNull(record.ROI_apreciaci_n),
    ext_enganche_porcentaje: numOrNull(record.Enganche_desarrollo),
    ext_tasa_interes: numOrNull(record.Tasa_inter_s_anual),

    ext_destacado: boolOrNull(record.Es_destacado),
    ext_publicado: boolOrNull(record.Publicado),

    foto_portada: pick<string>(record, "Cover_image_URL"),
    url_drive_general: pick<string>(record, "Drive_URL"),
    lista_precios: pick<string>(record, "Lista_precios_URL"),
    brochure_pdf: pick<string>(record, "Brochure_URL"),
    tour_virtual_desarrollo: pick<string>(record, "Virtual_tour_URL"),
    masterplan: pick<string>(record, "Masterplan_URL"),
    video_desarrollo: pick<string>(record, "Video_URL"),
    ext_source_url: pick<string>(record, "Source_URL"),

    calle: pick<string>(record, "Direcci_n_Street_Address"),
    municipio: pick<string>(record, "Direcci_n_City"),
    estado: pick<string>(record, "Direcci_n_State_Province"),
    codigo_postal: pick<string>(record, "Direcci_n_Zip_Postal_Code"),
    latitud: numOrNull(record.Direcci_n_Coordinates_Latitude),
    longitud: numOrNull(record.Direcci_n_Coordinates_Longitude),
    zona: pick<string>(record, "Zona"),
    ext_google_maps_url: pick<string>(record, "Maps_URL"),
    playa_distancia: pick<string>(record, "Playa_distancia"),
    aeropuerto_nombre: pick<string>(record, "Aeropuerto_nombre"),
    aeropuerto_distancia: pick<string>(record, "Aeropuerto_distancia"),
    pais: pick<string>(record, "Direcci_n_Country_Region") || "México",

    ext_commission_rate: numOrNull(record.Comisi_n),
    ext_plaza: pick<string>(record, "Plaza"),
    ext_badge: pick<string>(record, "Badge"),
    ext_property_types: Array.isArray(record.Tipos_propiedad)
      ? record.Tipos_propiedad
      : null,

    // Amenidades multiselect Zoho → 22 columnas booleanas Supabase
    ...zohoAmenidadesToSupabaseBools(record.Amenidades),

    zoho_modified_time: pick<string>(record, "Modified_Time"),
    zoho_last_synced_at: new Date().toISOString(),
    zoho_sync_error: null,
  };
}

/** Convierte el multiselect Amenidades de Zoho a las 22+ columnas
 *  booleanas que viven en Propyte_desarrollos. Útil cuando un asesor
 *  edita amenidades desde Zoho y el webhook necesita reflejarlo. */
function zohoAmenidadesToSupabaseBools(
  amenidades: unknown
): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (!Array.isArray(amenidades)) return out;
  const reverseMap = new Map(
    DEVELOPMENT_AMENIDADES_MAP.map(([col, label]) => [label, col])
  );
  for (const label of amenidades as string[]) {
    const col = reverseMap.get(label);
    if (col) out[col] = true;
  }
  return out;
}

export function zohoProductToSupabase(
  record: ZohoProduct
): Record<string, unknown> {
  return {
    zoho_record_id: record.id,
    titulo_unidad: pick<string>(record, "Product_Name"),
    slug_unidad: pick<string>(record, "Slug_URL"),
    subtitulo_unidad: pick<string>(record, "Subt_tulo"),
    meta_title_unidad: pick<string>(record, "Meta_t_tulo"),
    meta_description_unidad: pick<string>(record, "Meta_descripci_n"),
    keywords_unidad:
      typeof record.Keywords_SEO === "string" && record.Keywords_SEO
        ? record.Keywords_SEO.split(",").map((s) => s.trim()).filter(Boolean)
        : null,

    pipeline_status: normalizePipelineStatus(record.Pipeline_Status) ?? null,

    estado_unidad: pick<string>(record, "Estado_de_la_unidad"),
    descripcion_corta_unidad: pick<string>(record, "Descripci_n_corta"),
    descripcion_larga_unidad: pick<string>(record, "Descripci_n_larga"),
    content_features_es: pick<string>(record, "Contenido_caracter_ES"),
    content_location_es: pick<string>(record, "Contenido_ubicaci_n_ES"),
    content_lifestyle_es: pick<string>(record, "Contenido_lifestyle_ES"),

    superficie_total_m2: numOrNull(record.Metros_Cuadrados_Totales),
    superficie_construida_m2: numOrNull(record.Metros_cuadrados_Interior),
    superficie_terreno_m2: numOrNull(record.Metros_cuadrados_Exterior),
    banos_completos: numFromTextOrNull(record.Ba_os),
    recamaras: numFromTextOrNull(record.Rec_maras),
    medios_banos: numOrNull(record.Medios_ba_os),
    niveles_unidad: numOrNull(record.Niveles),
    piso_numero: numOrNull(record.Piso),
    estacionamientos: numOrNull(record.Cajones_de_estacionamiento),
    ext_tipologia: pick<string>(record, "Tipolog_a"),

    precio_mxn: numOrNull(record.Unit_Price),
    precio_usd: numOrNull(record.Precio_USD),
    precio_m2_mxn: numOrNull(record.Precio_m2_MXN),
    precio_m2_usd: numOrNull(record.Precio_m2_USD),
    precio_desde: numOrNull(record.Precio_desde),
    ext_precio_venta: numOrNull(record.Precio_llave_en_mano),
    moneda_principal: pick<string>(record, "Moneda_principal"),

    enganche_porcentaje: numOrNull(record.Enganche),
    ext_enganche_mxn: numOrNull(record.Enganche_MXN),
    ext_mensualidad_mxn: numOrNull(record.Mensualidad_MXN),
    ext_tasa_interes: numOrNull(record.Tasa_inter_s_anual),
    ext_esquema_pago: pick<string>(record, "Esquema_de_pago"),
    financiamiento_directo: boolOrNull(record.Financiamiento_directo),
    acepta_hipotecario: boolOrNull(record.Acepta_hipotecario),
    acepta_infonavit: boolOrNull(record.Acepta_INFONAVIT),
    ext_acepta_fovissste: boolOrNull(record.Acepta_FOVISSSTE),

    roi_anual_porcentaje: numOrNull(record.ROI_Anual),
    renta_mensual_estimada_mxn: numOrNull(record.Renta_mensual_MXN),
    apreciacion_anual_porcentaje: numOrNull(record.Apreciaci_n_anual),
    tipo_rendimiento: pick<string>(record, "Tipo_rendimiento"),

    tipo_unidad: pick<string>(record, "Tipo_unidad"),
    subtipo_unidad: pick<string>(record, "Subtipo_unidad"),
    orientacion: pick<string>(record, "Orientaci_n"),
    vista_unidad: pick<string>(record, "Vista_unidad"),
    tipo_entrega: pick<string>(record, "Tipo_entrega"),
    regimen_propiedad: pick<string>(record, "R_gimen_propiedad"),
    uso_suelo_unidad: pick<string>(record, "Uso_de_suelo"),

    es_destacada_unidad: boolOrNull(record.Es_destacada),
    es_preventa: boolOrNull(record.Es_preventa),
    es_nueva_unidad: boolOrNull(record.Es_nueva),
    amueblado: boolOrNull(record.Amueblado),
    equipado: boolOrNull(record.Equipado),
    mascotas_permitidas: boolOrNull(record.Mascotas_permitidas),
    ext_tiene_alberca: boolOrNull(record.Tiene_alberca),

    escritura_disponible: boolOrNull(record.Escritura_disponible),
    licencia_construccion: boolOrNull(record.Licencia_construcci_n),
    ext_predial_vigente: boolOrNull(record.Predial_al_corriente),
    ext_cert_libertad_gravamen: boolOrNull(record.Cert_lib_gravamen),
    fideicomiso_requerido: boolOrNull(record.Fideicomiso_requerido),
    ext_url_doc_uso_suelo: pick<string>(record, "Doc_uso_suelo_URL"),

    foto_portada_unidad: pick<string>(record, "Cover_image_URL"),
    tour_virtual_unidad: pick<string>(record, "Virtual_tour_URL"),
    plano_unidad: pick<string>(record, "Floor_plan_URL"),
    video_recorrido_unidad: pick<string>(record, "Video_URL"),

    zoho_modified_time: pick<string>(record, "Modified_Time"),
    zoho_last_synced_at: new Date().toISOString(),
    zoho_sync_error: null,
  };
}

export function zohoAccountToSupabaseDeveloper(
  record: ZohoAccount
): Record<string, unknown> {
  return {
    zoho_record_id: record.id,
    nombre_desarrollador: pick<string>(record, "Account_Name"),
    ext_slug_desarrollador: pick<string>(record, "Slug_URL"),
    telefono: pick<string>(record, "Phone"),
    sitio_web: pick<string>(record, "Website"),
    logo_url: pick<string>(record, "Logo_URL"),
    descripcion_es:
      pick<string>(record, "Descripci_n_ES") ?? pick<string>(record, "Description"),
    ciudad: pick<string>(record, "Billing_City"),
    estado: pick<string>(record, "Billing_State"),
    pais: pick<string>(record, "Billing_Country"),
    contacto_nombre: pick<string>(record, "Nombre_contacto"),
    contacto_puesto: pick<string>(record, "Puesto_contacto"),
    redes_sociales: pick<string>(record, "Redes_sociales"),
    verificado: boolOrNull(record.Es_verificado),
    rating: numOrNull(record.Rating_estrellas),
    proyectos_activos: numOrNull(record.Proyectos_activos),
    proyectos_entregados: numOrNull(record.Proyectos_entregados),
    unidades_entregadas: numOrNull(record.Unidades_entregadas),
    anios_experiencia: numOrNull(record.A_os_experiencia),
    rfc: pick<string>(record, "RFC"),
    razon_social: pick<string>(record, "Raz_n_social"),
    latitud: numOrNull(record.Latitud),
    longitud: numOrNull(record.Longitud),
    zona: pick<string>(record, "Zona"),
    link_maps: pick<string>(record, "Link_maps"),
    master_broker: boolOrNull(record.Master_Broker),
    industry: pick<string>(record, "Industry"),
    zoho_modified_time: pick<string>(record, "Modified_Time"),
    zoho_last_synced_at: new Date().toISOString(),
  };
}

function numOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function boolOrNull(v: unknown): boolean | null {
  if (v == null) return null;
  if (typeof v === "boolean") return v;
  if (v === "true" || v === 1) return true;
  if (v === "false" || v === 0) return false;
  return null;
}

function numFromTextOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(String(v).match(/\d+/)?.[0] ?? NaN);
  return Number.isFinite(n) ? n : null;
}

// ============================================================
// 6. Zoho → Supabase mappings (Leads / Contacts / Deals / Accounts genéricos)
//    Sin cambios — usados por sync-engine.ts FASE 2 (download CRM).
// ============================================================

export function zohoLeadToSupabase(lead: ZohoLead): Record<string, unknown> {
  return {
    zoho_record_id: lead.id,
    first_name: lead.First_Name || null,
    last_name: lead.Last_Name,
    email: lead.Email || null,
    phone: lead.Phone || null,
    mobile: lead.Mobile || null,
    company: lead.Company || null,
    lead_source: lead.Lead_Source || null,
    lead_status: lead.Lead_Status || null,
    owner_name: lead.Owner?.name || null,
    owner_id: lead.Owner?.id || null,
    nombre_campana: lead.Nombre_de_Campa_a || null,
    nombre_anuncio: lead.Nombre_anuncio || null,
    plataforma_llegada: lead.Plataforma_de_llegada || null,
    nombre_formulario: lead.Nombre_del_formulario || null,
    proyecto_interes_ids: lead.Proyecto_de_Interes?.map((p) => p.id) || null,
    interes: lead.Inter_s || null,
    mensaje: lead.Mensaje || null,
    idioma: lead.Idioma || null,
    broker: lead.Broker || false,
    candidato: lead.Candidato || false,
    duplicado: lead.Duplicado || false,
    etapa_interna: lead.Etapa_interna_de_contacto || null,
    llamada_1: lead.llamada_1 || false,
    llamada_2: lead.llamada_2 || false,
    llamada_3: lead.llamada_3 || false,
    llamada_4: lead.llamada_4 || false,
    llamada_5: lead.llamada_5 || false,
    llamada_6: lead.llamada_6 || false,
    llamada_7: lead.llamada_7 || false,
    llamada_8: lead.llamada_8 || false,
    whatsapp_1: lead.Whatsapp_1 || false,
    whatsapp_2: lead.Whatsapp_2 || false,
    whatsapp_3: lead.Whatsapp_3 || false,
    correo_1: lead.Correo_1 || false,
    correo_2: lead.Correo_2 || false,
    correo_3: lead.Correo_3 || false,
    correo_4: lead.Correo_4 || false,
    city: lead.City || null,
    state: lead.State || null,
    country: lead.Country || null,
    gclid: lead.GCLID || null,
    ad_campaign_name: lead.Ad_Campaign_Name || null,
    adgroup_name: lead.AdGroup_Name || null,
    zoho_created_time: lead.Created_Time || null,
    zoho_modified_time: lead.Modified_Time || null,
    extra_fields: extractExtraFields(lead, LEAD_MAPPED_FIELDS),
  };
}

export function zohoDealToSupabase(deal: ZohoDeal): Record<string, unknown> {
  return {
    zoho_record_id: deal.id,
    deal_name: deal.Deal_Name,
    stage: deal.Stage || null,
    amount: deal.Amount || null,
    closing_date: deal.Closing_Date || null,
    lead_source: deal.Lead_Source || null,
    monto_apartado: deal.Monto_del_apartado || null,
    monto_enganche: deal.Monto_del_enganche || null,
    precio_lista: deal.Precio_de_lista || null,
    precio_final: deal.Precio_final || null,
    saldo_contraentrega: deal.Saldo_contraentrega || null,
    mensualidades: deal.Mensualidades || null,
    descuento_autorizado: deal.Descuento_autorizado || null,
    metodo_pago: deal.Metodo_de_pago || null,
    fecha_apartado: deal.Fecha_de_Apartado || null,
    fecha_procesamiento: deal.Fecha_de_Procesamiento || null,
    estatus_contrato: deal.Estatus_de_contrato || null,
    carta_oferta_aceptada: deal.Carta_de_oferta_aceptada || null,
    cotizacion_enviada: deal.Cotizaci_n_Enviada || false,
    url_contrato_enviado: deal.URL_de_contrato_enviado || null,
    url_contrato_firmado: deal.URL_de_contrato_firmado || null,
    url_comprobante_domicilio: deal.URL_de_comprobante_de_domicilio || null,
    formato_kyc: deal.Formato_KYC || null,
    comprobante_enganche: deal.Comprobante_de_enganche || null,
    recibo_enganche: deal.Recibo_del_enganche || null,
    mobiliario: deal.Mobiliario || null,
    contact_zoho_id: deal.Contact_Name?.id || null,
    account_zoho_id: deal.Account_Name?.id || null,
    broker_asociado_zoho_id: deal.Broker_Asociado?.id || null,
    owner_name: deal.Owner?.name || null,
    owner_id: deal.Owner?.id || null,
    razon_descarte: deal.Raz_n_de_descarte || null,
    razon_perdida: deal.Reason_For_Loss__s || null,
    promocion: deal.Promocion || null,
    zoho_created_time: deal.Created_Time || null,
    zoho_modified_time: deal.Modified_Time || null,
    extra_fields: extractExtraFields(deal, DEAL_MAPPED_FIELDS),
  };
}

export function zohoContactToSupabase(
  contact: ZohoRecord
): Record<string, unknown> {
  return {
    zoho_record_id: contact.id,
    first_name: (contact.First_Name as string) || null,
    last_name: (contact.Last_Name as string) || null,
    email: (contact.Email as string) || null,
    phone: (contact.Phone as string) || null,
    mobile: (contact.Mobile as string) || null,
    account_name: (contact.Account_Name as { name?: string })?.name || null,
    account_zoho_id: (contact.Account_Name as { id?: string })?.id || null,
    owner_name: (contact.Owner as { name?: string })?.name || null,
    owner_id: (contact.Owner as { id?: string })?.id || null,
    mailing_city: (contact.Mailing_City as string) || null,
    mailing_state: (contact.Mailing_State as string) || null,
    mailing_country: (contact.Mailing_Country as string) || null,
    zoho_created_time: (contact.Created_Time as string) || null,
    zoho_modified_time: (contact.Modified_Time as string) || null,
    extra_fields: extractExtraFields(contact, CONTACT_MAPPED_FIELDS),
  };
}

export function zohoAccountToSupabase(
  account: ZohoAccount
): Record<string, unknown> {
  return {
    zoho_record_id: account.id,
    account_name: account.Account_Name,
    phone: account.Phone || null,
    website: account.Website || null,
    industry: account.Industry || null,
    billing_city: account.Billing_City || null,
    billing_state: account.Billing_State || null,
    billing_country: account.Billing_Country || null,
    owner_name: account.Owner?.name || null,
    owner_id: account.Owner?.id || null,
    zoho_created_time: account.Created_Time || null,
    zoho_modified_time: account.Modified_Time || null,
    extra_fields: extractExtraFields(account, ACCOUNT_MAPPED_FIELDS),
  };
}

// ============================================================
// 7. Helpers
// ============================================================

const SYSTEM_FIELDS = new Set([
  "id", "Created_Time", "Modified_Time", "Created_By", "Modified_By",
  "Tag", "Record_Image", "Locked__s", "$currency_symbol", "$converted",
  "$approved", "$editable", "$orchestration", "$review_process",
  "$in_merge", "$approval_state", "$converted_detail", "$followed",
  "$review", "$state", "$process_flow", "$sharing_permission",
  "Data_Processing_Basis_Details", "Data_Processing_Basis", "Data_Source",
  "Unsubscribed_Mode", "Unsubscribed_Time", "Change_Log_Time__s",
  "Last_Activity_Time", "Last_Enriched_Time__s", "Enrich_Status__s",
  "Owner",
]);

const LEAD_MAPPED_FIELDS = new Set([
  "id", "First_Name", "Last_Name", "Email", "Phone", "Mobile", "Company",
  "Lead_Source", "Lead_Status", "Owner", "Nombre_de_Campa_a", "Nombre_anuncio",
  "Plataforma_de_llegada", "Nombre_del_formulario", "Proyecto_de_Interes",
  "Inter_s", "Mensaje", "Idioma", "Broker", "Candidato", "Duplicado",
  "Etapa_interna_de_contacto", "llamada_1", "llamada_2", "llamada_3",
  "llamada_4", "llamada_5", "llamada_6", "llamada_7", "llamada_8",
  "Whatsapp_1", "Whatsapp_2", "Whatsapp_3", "Correo_1", "Correo_2",
  "Correo_3", "Correo_4", "City", "State", "Country", "GCLID",
  "Ad_Campaign_Name", "AdGroup_Name", "Created_Time", "Modified_Time",
]);

const DEAL_MAPPED_FIELDS = new Set([
  "id", "Deal_Name", "Stage", "Amount", "Closing_Date", "Lead_Source",
  "Contact_Name", "Account_Name", "Owner", "Monto_del_apartado",
  "Monto_del_enganche", "Precio_de_lista", "Precio_final",
  "Saldo_contraentrega", "Mensualidades", "Descuento_autorizado",
  "Metodo_de_pago", "Fecha_de_Apartado", "Fecha_de_Procesamiento",
  "Estatus_de_contrato", "Carta_de_oferta_aceptada", "Cotizaci_n_Enviada",
  "URL_de_contrato_enviado", "URL_de_contrato_firmado",
  "URL_de_comprobante_de_domicilio", "Formato_KYC",
  "Comprobante_de_enganche", "Recibo_del_enganche", "Mobiliario",
  "Broker_Asociado", "Raz_n_de_descarte", "Reason_For_Loss__s",
  "Promocion", "Created_Time", "Modified_Time",
]);

const CONTACT_MAPPED_FIELDS = new Set([
  "id", "First_Name", "Last_Name", "Email", "Phone", "Mobile",
  "Account_Name", "Owner", "Mailing_City", "Mailing_State",
  "Mailing_Country", "Created_Time", "Modified_Time",
]);

const ACCOUNT_MAPPED_FIELDS = new Set([
  "id", "Account_Name", "Phone", "Website", "Industry",
  "Billing_City", "Billing_State", "Billing_Country", "Owner",
  "Created_Time", "Modified_Time",
]);

function extractExtraFields(
  record: ZohoRecord,
  mappedFields: Set<string>
): Record<string, unknown> {
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (!mappedFields.has(key) && !SYSTEM_FIELDS.has(key) && !key.startsWith("$")) {
      if (value != null && value !== "" && value !== false) {
        extra[key] = value;
      }
    }
  }
  return Object.keys(extra).length > 0 ? extra : {};
}

// Re-export para que el sync-engine pueda preguntar SOT
export { pipelineSourceOfTruth } from "./types";
