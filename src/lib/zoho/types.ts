// ============================================================
// Zoho CRM TypeScript Types
// Interfaces para records, responses, y configuración
// Refactor 2026-05-22 — Fase 6 sync engine:
//   - PipelineStatus pasa al esquema de 5 estados (Borrador/Revision/
//     Publicado/Rechazado/Terminado) alineado con enum Supabase
//     `real_estate_hub.pipeline_status_enum`.
//   - ZohoProduct / ZohoProyectoInmobiliario / ZohoAccount extendidas
//     con los 133 fields nuevos creados en prod 2026-05-22.
//   - Helper `pipelineSourceOfTruth()` define quién gana por estado.
// ============================================================

// --- Zoho API Response Types ---

export interface ZohoTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  api_domain: string;
  error?: string;
}

export interface ZohoRecordResponse {
  data: ZohoRecord[];
  info: {
    per_page: number;
    count: number;
    page: number;
    more_records: boolean;
  };
}

export interface ZohoUpsertResponse {
  data: Array<{
    code: string;
    details: {
      id: string;
      Modified_Time: string;
      Created_Time: string;
    };
    message: string;
    status: string;
  }>;
}

export interface ZohoErrorResponse {
  code: string;
  details: Record<string, unknown>;
  message: string;
  status: string;
}

// --- Zoho Record (generic) ---

export interface ZohoRecord {
  id?: string;
  [key: string]: unknown;
}

// --- Pipeline Status (alineado con real_estate_hub.pipeline_status_enum) ---

export type PipelineStatus =
  | "Borrador"
  | "Revision"
  | "Publicado"
  | "Rechazado"
  | "Terminado";

/**
 * Source-of-truth por estado del pipeline.
 *  - Borrador/Revision  → Zoho gana (asesor edita); el sync escribe Zoho → Supabase.
 *  - Publicado          → Hub gana; el sync escribe Supabase → Zoho.
 *  - Rechazado/Terminado→ Hub gana; Hub puede seguir editando metadatos.
 *  - null / unknown     → 'none' (no se sincroniza ni en una dirección ni en la otra).
 */
export type SourceOfTruth = "zoho" | "hub" | "none";

export function pipelineSourceOfTruth(
  status: PipelineStatus | string | null | undefined
): SourceOfTruth {
  switch (status) {
    case "Borrador":
    case "Revision":
      return "zoho";
    case "Publicado":
    case "Rechazado":
    case "Terminado":
      return "hub";
    default:
      return "none";
  }
}

/** Mantenido por compatibilidad con dashboards/reportes legacy. NO usar en sync. */
export type LegacyZohoPipelineStatus =
  | "discovery"
  | "analisis"
  | "presentacion"
  | "aprobado"
  | "listo"
  | "pausa"
  | "descartado";

// --- Zoho Module-Specific Records ---

/**
 * Proyectos_Inmobiliarios — extendido 2026-05-22 con los 51 fields del manifest
 * `PROD_REPLICATION_MANIFEST.json`. Fields opcionales: el sync omite `null`
 * antes de enviar a Zoho.
 */
export interface ZohoProyectoInmobiliario extends ZohoRecord {
  Name: string;

  // Campos legacy preservados
  Domicilio?: string;
  Colonia?: string;
  Estado?: string;
  Municipio?: string;
  C_digo_Postal?: number;
  Pa_s?: string;
  Sitio_Web?: string;
  Facebook?: string;
  Instagram?: string;
  Descripcion?: string;
  Unidades_disponibles?: number;
  Comisi_n?: number;
  Fotos?: string;
  Direcci_n_Coordinates_Latitude?: number;
  Direcci_n_Coordinates_Longitude?: number;

  // === Fields nuevos 2026-05-22 ===
  Pipeline_Status?: PipelineStatus;
  Slug_URL?: string;
  T_tulo_publicaci_n?: string;
  Descripci_n_corta_ES?: string;
  Descripci_n_ES?: string;
  Contenido_caracter_ES?: string;
  Contenido_ubicaci_n_ES?: string;
  Contenido_lifestyle_ES?: string;
  Meta_t_tulo?: string;
  Meta_descripci_n?: string;
  Keywords_SEO?: string;
  Etapa_construcci_n?: string;
  Tipo_desarrollo?: string;
  Avance_obra?: number;
  Fecha_entrega?: string;
  Unidades_totales?: number;
  Unidades_reservadas?: number;
  Unidades_vendidas?: number;
  Precio_m_nimo_MXN?: number;
  Precio_m_ximo_MXN?: number;
  ROI_proyectado?: number;
  ROI_renta_mensual?: number;
  ROI_apreciaci_n?: number;
  Enganche_desarrollo?: number;
  Tasa_inter_s_anual?: number;
  Es_destacado?: boolean;
  Publicado?: boolean;
  Cover_image_URL?: string;
  Drive_URL?: string;
  Lista_precios_URL?: string;
  Brochure_URL?: string;
  Brochure_URL_EN?: string;
  Carpeta_de_Im_genes_1?: string;
  Carpeta_de_Im_genes_2?: string;
  Plano_URL?: string;
  Virtual_tour_URL?: string;
  Masterplan_URL?: string;
  Video_URL?: string;
  Zona?: string;
  Maps_URL?: string;
  Playa_distancia?: string;
  Aeropuerto_nombre?: string;
  Aeropuerto_distancia?: string;
  Amenidades?: string[];
  Cercan_as?: string[];
  Desarrollador?: { id: string } | null;
  Asesor_responsable?: { id: string } | null;
  Tipos_propiedad?: string[];
  Plaza?: string;
  Badge?: string;
  Source_URL?: string;
  Concepto_dise_o?: string;
  Arquitecto?: string;
  Fases_totales?: number;
  Fase_actual?: number;
}

/**
 * Products (Unidades) — extendido 2026-05-22.
 * NOTA: `Rec_maras` y `Ba_os` siguen siendo TEXT por decisión Luis (workflows
 * los usan). El sync escribe como string. Los duplicados `Bedrooms`/
 * `Ba_os_completos` fueron eliminados — NO escribir a esos.
 */
export interface ZohoProduct extends ZohoRecord {
  Product_Name: string;
  Proyecto_inmobiliario?: { id: string };

  // Campos legacy preservados
  Estado_de_la_unidad?: string;
  Metros_cuadrados_Interior?: number;
  Metros_cuadrados_Exterior?: number;
  Metros_Cuadrados_Totales?: number; // fórmula en Zoho
  Ba_os?: string;        // TEXT, label "Baños Completos"
  Rec_maras?: string;    // TEXT, label "Recámaras"
  Cajones_de_estacionamiento?: number;
  Plano?: string;
  Render?: string;
  Lock_off?: string;
  Alberca?: string;
  Modelo?: string;
  Nivel?: string;
  Tipolog_a?: string;
  Fotos?: string;
  Unit_Price?: number;   // label renombrada "Precio MXN"

  // === Fields nuevos 2026-05-22 ===
  Pipeline_Status?: PipelineStatus;
  Slug_URL?: string;
  Subt_tulo?: string;
  Descripci_n_corta?: string;
  Descripci_n_larga?: string;
  Contenido_caracter_ES?: string;
  Contenido_ubicaci_n_ES?: string;
  Contenido_lifestyle_ES?: string;
  Meta_t_tulo?: string;
  Meta_descripci_n?: string;
  Keywords_SEO?: string;
  Medios_ba_os?: number;
  Niveles?: number;
  Piso?: number;
  Precio_USD?: number;
  Precio_m2_MXN?: number;
  Precio_m2_USD?: number;
  Precio_desde?: number;
  Enganche?: number;
  Enganche_MXN?: number;
  Mensualidad_MXN?: number;
  ROI_Anual?: number;
  Renta_mensual_MXN?: number;
  Apreciaci_n_anual?: number;
  Costo_escrituraci_n?: number;
  Amenidades?: string[];
  Cercan_as?: string[];
  Desarrollo?: { id: string } | null;
  Asesor_responsable?: { id: string } | null;
  Tiene_alberca?: boolean;
  Plazo_meses?: number;
  Tasa_inter_s_anual?: number;
  Esquema_de_pago?: string;
  Escritura_disponible?: boolean;
  Licencia_construcci_n?: boolean;
  Predial_al_corriente?: boolean;
  Cert_lib_gravamen?: boolean;
  Fideicomiso_requerido?: boolean;
  Doc_uso_suelo_URL?: string;
  Precio_llave_en_mano?: number;
  Es_destacada?: boolean;
  Es_preventa?: boolean;
  Es_nueva?: boolean;
  Amueblado?: boolean;
  Equipado?: boolean;
  Mascotas_permitidas?: boolean;
  Acepta_hipotecario?: boolean;
  Acepta_INFONAVIT?: boolean;
  Acepta_FOVISSSTE?: boolean;
  Financiamiento_directo?: boolean;
  Tipo_unidad?: string;
  Subtipo_unidad?: string;
  Orientaci_n?: string;
  Vista_unidad?: string;
  Moneda_principal?: string;
  Tipo_rendimiento?: string;
  Tipo_entrega?: string;
  R_gimen_propiedad?: string;
  Uso_de_suelo?: string;
  Cover_image_URL?: string;
  Virtual_tour_URL?: string;
  Floor_plan_URL?: string;
  Video_URL?: string;
}

export interface ZohoLead extends ZohoRecord {
  First_Name?: string;
  Last_Name: string;
  Email?: string;
  Phone?: string;
  Mobile?: string;
  Company?: string;
  Lead_Source?: string;
  Lead_Status?: string;
  Owner?: { name: string; id: string };
  Nombre_de_Campa_a?: string;
  Nombre_anuncio?: string;
  Plataforma_de_llegada?: string;
  Nombre_del_formulario?: string;
  Proyecto_de_Interes?: Array<{ id: string }>;
  Inter_s?: string;
  Mensaje?: string;
  Idioma?: string;
  Broker?: boolean;
  Candidato?: boolean;
  Duplicado?: boolean;
  Etapa_interna_de_contacto?: string[];
  llamada_1?: boolean;
  llamada_2?: boolean;
  llamada_3?: boolean;
  llamada_4?: boolean;
  llamada_5?: boolean;
  llamada_6?: boolean;
  llamada_7?: boolean;
  llamada_8?: boolean;
  Whatsapp_1?: boolean;
  Whatsapp_2?: boolean;
  Whatsapp_3?: boolean;
  Correo_1?: boolean;
  Correo_2?: boolean;
  Correo_3?: boolean;
  Correo_4?: boolean;
  City?: string;
  State?: string;
  Country?: string;
  GCLID?: string;
  Ad_Campaign_Name?: string;
  AdGroup_Name?: string;
  Created_Time?: string;
  Modified_Time?: string;
}

export interface ZohoDeal extends ZohoRecord {
  Deal_Name: string;
  Stage?: string;
  Amount?: number;
  Closing_Date?: string;
  Lead_Source?: string;
  Contact_Name?: { id: string };
  Account_Name?: { id: string };
  Owner?: { name: string; id: string };
  Monto_del_apartado?: number;
  Monto_del_enganche?: number;
  Precio_de_lista?: number;
  Precio_final?: number;
  Saldo_contraentrega?: number;
  Mensualidades?: number;
  Descuento_autorizado?: number;
  Metodo_de_pago?: string;
  Fecha_de_Apartado?: string;
  Fecha_de_Procesamiento?: string;
  Estatus_de_contrato?: string;
  Carta_de_oferta_aceptada?: string;
  Cotizaci_n_Enviada?: boolean;
  URL_de_contrato_enviado?: string;
  URL_de_contrato_firmado?: string;
  URL_de_comprobante_de_domicilio?: string;
  Formato_KYC?: string;
  Comprobante_de_enganche?: string;
  Recibo_del_enganche?: string;
  Mobiliario?: string;
  Broker_Asociado?: { id: string };
  Raz_n_de_descarte?: string;
  Reason_For_Loss__s?: string;
  Promocion?: string;
  Created_Time?: string;
  Modified_Time?: string;
}

/**
 * Accounts (Desarrolladores) — extendido 2026-05-22 con 19 fields nuevos.
 * Avica Inmobiliaria vive aquí con `Tipo_de_Empresa='Desarrollador'`.
 */
export interface ZohoAccount extends ZohoRecord {
  Account_Name: string;
  Phone?: string;
  Website?: string;
  Industry?: string;
  Billing_City?: string;
  Billing_State?: string;
  Billing_Country?: string;
  Owner?: { name: string; id: string };
  Description?: string;
  Created_Time?: string;
  Modified_Time?: string;

  // === Fields nuevos 2026-05-22 ===
  Slug_URL?: string;
  Logo_URL?: string;
  Descripci_n_ES?: string;
  Nombre_contacto?: string;
  Puesto_contacto?: string;
  Redes_sociales?: string;
  Es_verificado?: boolean;
  Rating_estrellas?: number;
  Proyectos_activos?: number;
  Proyectos_entregados?: number;
  Unidades_entregadas?: number;
  A_os_experiencia?: number;
  RFC?: string;
  Raz_n_social?: string;
  Latitud?: number;
  Longitud?: number;
  Zona?: string;
  Link_maps?: string;
  Master_Broker?: boolean;
}

// --- Sync Engine Types ---

export type SyncDirection = "to_zoho" | "from_zoho";
export type SyncOperation =
  | "create"
  | "update"
  | "skip"
  | "error"
  | "conflict_resolved";
export type EntityType =
  | "development"
  | "unit"
  | "developer"
  | "lead"
  | "contact"
  | "deal"
  | "account";

export interface SyncLogEntry {
  sync_run_id: string;
  direction: SyncDirection;
  entity_type: EntityType;
  operation: SyncOperation;
  record_id?: string;
  zoho_record_id?: string;
  details?: Record<string, unknown>;
  error_message?: string;
}

export interface SyncRunResult {
  sync_run_id: string;
  started_at: Date;
  finished_at: Date;
  to_zoho: { created: number; updated: number; skipped: number; errors: number };
  from_zoho: { created: number; updated: number; skipped: number; errors: number };
  api_calls_used: number;
}

export interface SyncStatus {
  last_run: SyncRunResult | null;
  api_calls_today: number;
  api_calls_limit: number;
  pending_developments: number;
  total_mapped: Record<EntityType, number>;
  recent_errors: SyncLogEntry[];
}
