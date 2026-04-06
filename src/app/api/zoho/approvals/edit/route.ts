// ============================================================
// API Route: /api/zoho/approvals/edit
// PATCH: editar campos de desarrolladores, desarrollos o unidades
// Escribe directo a real_estate_hub (y opcionalmente a public)
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import { getSupabaseServiceClient } from "@/lib/supabase";

// Whitelist de campos editables por entity_type
const EDITABLE_FIELDS: Record<string, Set<string>> = {
  developer: new Set([
    "nombre_desarrollador", "ext_slug_desarrollador", "logo", "sitio_web",
    "descripcion", "ext_descripcion_en", "telefono", "email",
    "es_verificado", "ext_ciudad", "ext_estado",
  ]),
  development: new Set([
    "nombre_desarrollo", "ext_slug_desarrollo", "ciudad", "estado", "tipo_desarrollo",
    "etapa_construccion", "avance_obra_porcentaje", "fecha_entrega", "ext_fecha_entrega_texto",
    "unidades_totales", "unidades_disponibles", "ext_reserved_units", "ext_sold_units",
    "ext_precio_min_mxn", "ext_precio_max_mxn", "ext_moneda",
    "ext_commission_rate", "ext_crm_relationship", "ext_plaza",
    "ext_roi_proyectado", "ext_roi_renta_mensual", "ext_roi_apreciacion",
    "ext_enganche_porcentaje", "ext_meses_financiamiento", "ext_tasa_interes",
    "ext_descripcion_es", "ext_descripcion_en",
    "ext_descripcion_corta_es", "ext_descripcion_corta_en", "ext_texto_brochure",
    "fotos_desarrollo", "brochure_pdf", "tour_virtual_desarrollo", "video_desarrollo", "url_drive_general",
    "latitud", "longitud", "zona", "calle",
    "ext_publicado", "ext_destacado",
    "ext_property_types", "ext_usage", "ext_badge",
    "ext_contacto_nombre", "ext_contacto_telefono",
    "ext_detection_source", "ext_source_url",
    "id_desarrollador",
    // Amenidades
    "amenidad_lobby", "amenidad_gym", "amenidad_alberca_privada", "amenidad_alberca_comunitaria",
    "amenidad_spa", "amenidad_rooftop", "amenidad_coworking", "amenidad_yoga",
    "amenidad_bodega", "amenidad_elevador", "amenidad_cancha", "amenidad_pet_zone",
    "amenidad_fire_pit", "amenidad_restaurante", "amenidad_concierge",
    "amenidad_jardin_comunitario", "amenidades_adicionales",
  ]),
  unit: new Set([
    "slug_unidad", "ext_numero_unidad", "tipo_unidad", "ext_tipologia",
    "recamaras", "banos_completos", "superficie_total_m2",
    "piso_numero", "precio_mxn", "precio_usd", "ext_precio_venta",
    "estado_unidad", "ext_publicado", "ext_tiene_alberca",
    "fotos_unidad", "plano_unidad",
    "descripcion_corta_unidad", "ext_descripcion_en",
  ]),
};

// Mapeo de campos real_estate_hub → public schema (para dual-write)
const HUB_TO_PUBLIC_MAP: Record<string, Record<string, string>> = {
  developer: {
    nombre_desarrollador: "name",
    ext_slug_desarrollador: "slug",
    logo: "logo_url",
    sitio_web: "website",
    descripcion: "description_es",
    ext_descripcion_en: "description_en",
    telefono: "phone",
    email: "email",
    es_verificado: "verified",
    ext_ciudad: "city",
    ext_estado: "state",
  },
  development: {
    nombre_desarrollo: "name",
    ext_slug_desarrollo: "slug",
    ciudad: "city",
    estado: "state",
    tipo_desarrollo: "development_type",
    etapa_construccion: "stage",
    avance_obra_porcentaje: "construction_progress",
    fecha_entrega: "estimated_delivery",
    ext_fecha_entrega_texto: "delivery_text",
    unidades_totales: "total_units",
    unidades_disponibles: "available_units",
    ext_reserved_units: "reserved_units",
    ext_sold_units: "sold_units",
    ext_precio_min_mxn: "price_min_mxn",
    ext_precio_max_mxn: "price_max_mxn",
    ext_moneda: "currency",
    ext_commission_rate: "commission_rate",
    ext_crm_relationship: "crm_relationship",
    ext_plaza: "plaza",
    ext_roi_proyectado: "roi_projected",
    ext_roi_renta_mensual: "roi_rental_monthly",
    ext_roi_apreciacion: "roi_appreciation",
    ext_enganche_porcentaje: "financing_down_payment",
    ext_meses_financiamiento: "financing_months",
    ext_tasa_interes: "financing_interest",
    ext_descripcion_es: "description_es",
    ext_descripcion_en: "description_en",
    ext_descripcion_corta_es: "descripcion_corta_es",
    ext_descripcion_corta_en: "descripcion_corta_en",
    ext_texto_brochure: "texto_brochure",
    fotos_desarrollo: "images",
    brochure_pdf: "brochure_url",
    tour_virtual_desarrollo: "virtual_tour_url",
    video_desarrollo: "video_url",
    url_drive_general: "drive_url",
    latitud: "lat",
    longitud: "lng",
    zona: "zone",
    calle: "address",
    ext_publicado: "published",
    ext_destacado: "featured",
    ext_property_types: "property_types",
    ext_usage: "usage",
    ext_badge: "badge",
    ext_contacto_nombre: "contact_name",
    ext_contacto_telefono: "contact_phone",
    ext_detection_source: "detection_source",
    ext_source_url: "source_url",
    id_desarrollador: "developer_id",
  },
  unit: {
    slug_unidad: "slug",
    ext_numero_unidad: "unit_number",
    tipo_unidad: "unit_type",
    ext_tipologia: "typology",
    recamaras: "bedrooms",
    banos_completos: "bathrooms",
    superficie_total_m2: "area_m2",
    piso_numero: "floor",
    precio_mxn: "price_mxn",
    precio_usd: "price_usd",
    ext_precio_venta: "sale_price",
    estado_unidad: "status",
    ext_publicado: "published",
    ext_tiene_alberca: "has_pool",
    fotos_unidad: "images",
    descripcion_corta_unidad: "description_es",
    ext_descripcion_en: "description_en",
  },
};

const TABLE_MAP: Record<string, string> = {
  developer: "Propyte_desarrolladores",
  development: "Propyte_desarrollos",
  unit: "Propyte_unidades",
};

const PUBLIC_TABLE_MAP: Record<string, string> = {
  developer: "developers",
  development: "developments",
  unit: "units",
};

export async function PATCH(request: NextRequest) {
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  if (!["ADMIN", "DIRECTOR", "GERENTE"].includes(session.user.role)) {
    return NextResponse.json({ error: "Sin permisos para editar" }, { status: 403 });
  }

  const supabase = getSupabaseServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  let body: { entity_type: string; id: string; fields: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const { entity_type, id, fields } = body;

  if (!entity_type || !id || !fields || typeof fields !== "object") {
    return NextResponse.json({ error: "entity_type, id y fields son requeridos" }, { status: 400 });
  }

  if (!TABLE_MAP[entity_type]) {
    return NextResponse.json({ error: `entity_type inválido: ${entity_type}` }, { status: 400 });
  }

  // Filter only whitelisted fields
  const allowedFields = EDITABLE_FIELDS[entity_type];
  const sanitizedFields: Record<string, unknown> = {};
  const rejectedFields: string[] = [];

  for (const [key, value] of Object.entries(fields)) {
    if (allowedFields.has(key)) {
      sanitizedFields[key] = value;
    } else {
      rejectedFields.push(key);
    }
  }

  if (Object.keys(sanitizedFields).length === 0) {
    return NextResponse.json({
      error: "No hay campos válidos para actualizar",
      rejectedFields,
    }, { status: 400 });
  }

  // 1. Update real_estate_hub directly
  const { error: hubError } = await supabase
    .schema("real_estate_hub")
    .from(TABLE_MAP[entity_type])
    .update({ ...sanitizedFields, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (hubError) {
    return NextResponse.json({ error: `Error real_estate_hub: ${hubError.message}` }, { status: 500 });
  }

  // 2. Dual-write to public schema (best-effort, so sync triggers don't overwrite)
  const fieldMap = HUB_TO_PUBLIC_MAP[entity_type] || {};
  const publicFields: Record<string, unknown> = {};
  for (const [hubKey, value] of Object.entries(sanitizedFields)) {
    const publicKey = fieldMap[hubKey];
    if (publicKey) {
      publicFields[publicKey] = value;
    }
  }

  let publicUpdated = false;
  if (Object.keys(publicFields).length > 0) {
    const { error: publicError } = await supabase
      .from(PUBLIC_TABLE_MAP[entity_type])
      .update({ ...publicFields, updated_at: new Date().toISOString() })
      .eq("id", id);

    if (publicError) {
      console.warn(`[EDIT] Warning: public schema update failed for ${entity_type}/${id}:`, publicError.message);
    } else {
      publicUpdated = true;
    }
  }

  return NextResponse.json({
    success: true,
    updated_fields: Object.keys(sanitizedFields),
    rejected_fields: rejectedFields.length > 0 ? rejectedFields : undefined,
    public_synced: publicUpdated,
    edited_by: session.user.name || session.user.email,
  });
}
