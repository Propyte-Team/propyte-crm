// ============================================================
// Zoho CRM TypeScript Types
// Interfaces para records, responses, y configuración
// ============================================================

// --- Zoho API Response Types ---

export interface ZohoTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number; // seconds (3600 = 1 hour)
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
    code: string; // 'SUCCESS', 'DUPLICATE_DATA', etc.
    details: {
      id: string;
      Modified_Time: string;
      Created_Time: string;
    };
    message: string;
    status: string; // 'success' | 'error'
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

// --- Zoho Module-Specific Records ---

export interface ZohoProyectoInmobiliario extends ZohoRecord {
  Name: string;
  Domicilio?: string;
  Colonia?: string;
  Estado?: string;
  Municipio?: string;
  C_digo_Postal?: number;
  Pa_s?: string;
  Brochure?: string;
  Sitio_Web?: string;
  Facebook?: string;
  Instagram?: string;
  Descripcion?: string;
  Unidades_disponibles?: number;
  Comisi_n?: number;
  Fotos?: string;
}

export interface ZohoProduct extends ZohoRecord {
  Product_Name: string;
  Proyecto_inmobiliario?: { id: string };
  Estado_de_la_unidad?: string;
  Metros_cuadrados_Interior?: number;
  Metros_cuadrados_Exterior?: number;
  Ba_os?: string;
  Rec_maras?: string;
  Plano?: string;
  Render?: string;
  Lock_off?: string;
  Alberca?: string;
  Modelo?: string;
  Nivel?: string;
  Tipolog_a?: string;
  Fotos?: string;
  Unit_Price?: number;
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

export interface ZohoAccount extends ZohoRecord {
  Account_Name: string;
  Phone?: string;
  Website?: string;
  Industry?: string;
  Billing_City?: string;
  Billing_State?: string;
  Billing_Country?: string;
  Owner?: { name: string; id: string };
  Created_Time?: string;
  Modified_Time?: string;
}

// --- Sync Engine Types ---

export type SyncDirection = "to_zoho" | "from_zoho";
export type SyncOperation = "create" | "update" | "skip" | "error" | "conflict_resolved";
export type EntityType = "development" | "unit" | "lead" | "contact" | "deal" | "account";
export type PipelineStatus = "discovery" | "analisis" | "presentacion" | "aprobado" | "listo" | "pausa" | "descartado";

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
  pending_developments: number; // aprobados que aún no se sincronizan
  total_mapped: Record<EntityType, number>;
  recent_errors: SyncLogEntry[];
}
