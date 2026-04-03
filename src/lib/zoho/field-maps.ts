// ============================================================
// Field Mappings: Supabase ↔ Zoho CRM
// Define cómo se traducen campos entre ambos sistemas
// ============================================================

import type {
  ZohoProyectoInmobiliario,
  ZohoProduct,
  ZohoLead,
  ZohoDeal,
  ZohoAccount,
  ZohoRecord,
} from "./types";

// --- Types ---

interface FieldMapping {
  supabase: string;
  zoho: string;
  transform?: "first_array_item" | "to_string" | "to_number" | "lookup_id";
}

// --- Development → Proyectos_Inmobiliarios ---

const DEVELOPMENT_FIELDS: FieldMapping[] = [
  { supabase: "nombre_desarrollo", zoho: "Name" },
  { supabase: "calle", zoho: "Domicilio" },
  { supabase: "zona", zoho: "Colonia" },
  { supabase: "estado", zoho: "Estado" },
  { supabase: "ciudad", zoho: "Municipio" },
  { supabase: "ext_descripcion_es", zoho: "Descripcion" },
  { supabase: "unidades_disponibles", zoho: "Unidades_disponibles", transform: "to_number" },
  { supabase: "ext_commission_rate", zoho: "Comisi_n", transform: "to_number" },
  { supabase: "fotos_desarrollo", zoho: "Fotos", transform: "first_array_item" },
  { supabase: "brochure_pdf", zoho: "Sitio_Web" },
];

export function developmentToZoho(
  dev: Record<string, unknown>
): ZohoProyectoInmobiliario {
  const record: Record<string, unknown> = { Pa_s: "Mexico" };

  for (const field of DEVELOPMENT_FIELDS) {
    const value = dev[field.supabase];
    if (value == null) continue;

    switch (field.transform) {
      case "first_array_item":
        record[field.zoho] = Array.isArray(value) ? value[0] || null : value;
        break;
      case "to_number":
        record[field.zoho] = Number(value) || null;
        break;
      case "to_string":
        record[field.zoho] = String(value);
        break;
      default:
        record[field.zoho] = value;
    }
  }

  return record as ZohoProyectoInmobiliario;
}

// --- Unit → Products ---

const UNIT_FIELDS: FieldMapping[] = [
  { supabase: "estado_unidad", zoho: "Estado_de_la_unidad" },
  { supabase: "superficie_total_m2", zoho: "Metros_cuadrados_Interior", transform: "to_number" },
  { supabase: "banos_completos", zoho: "Ba_os", transform: "to_string" },
  { supabase: "recamaras", zoho: "Rec_maras", transform: "to_string" },
  { supabase: "ext_tipologia", zoho: "Tipolog_a" },
  { supabase: "piso_numero", zoho: "Nivel", transform: "to_string" },
  { supabase: "fotos_unidad", zoho: "Fotos", transform: "first_array_item" },
  { supabase: "precio_mxn", zoho: "Unit_Price", transform: "to_number" },
  { supabase: "ext_tiene_alberca", zoho: "Alberca" },
];

export function unitToZoho(
  unit: Record<string, unknown>,
  parentZohoId: string
): ZohoProduct {
  const record: Record<string, unknown> = {};

  // Product_Name = slug or unit number
  record.Product_Name =
    unit.slug_unidad || unit.ext_numero_unidad || `Unidad ${unit.id}`;

  // Lookup al proyecto padre
  if (parentZohoId) {
    record.Proyecto_inmobiliario = { id: parentZohoId };
  }

  for (const field of UNIT_FIELDS) {
    const value = unit[field.supabase];
    if (value == null) continue;

    switch (field.transform) {
      case "first_array_item":
        record[field.zoho] = Array.isArray(value) ? value[0] || null : value;
        break;
      case "to_number":
        record[field.zoho] = Number(value) || null;
        break;
      case "to_string":
        record[field.zoho] = String(value);
        break;
      default:
        record[field.zoho] = value;
    }
  }

  // Alberca: boolean → picklist value
  if (unit.ext_tiene_alberca === true) {
    record.Alberca = "Sí";
  } else if (unit.ext_tiene_alberca === false) {
    record.Alberca = "No";
  }

  return record as ZohoProduct;
}

// --- Zoho Lead → Supabase Propyte_zoho_leads ---

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
    // Campos no mapeados explícitamente → extra_fields
    extra_fields: extractExtraFields(lead, LEAD_MAPPED_FIELDS),
  };
}

// --- Zoho Deal → Supabase Propyte_zoho_deals ---

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

// --- Zoho Contact → Supabase Propyte_zoho_contacts ---

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

// --- Zoho Account → Supabase Propyte_zoho_accounts ---

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

// --- Helper: Extract unmapped fields into extra_fields JSONB ---

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
