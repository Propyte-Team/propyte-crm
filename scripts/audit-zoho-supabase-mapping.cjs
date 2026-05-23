/* Auditoría Supabase ↔ Zoho — Propyte_desarrollos → Proyectos_Inmobiliarios.
 * Lee field-maps.ts + cache getFields Zoho + lista hardcodeada de cols Supabase
 * (de la query previa). Reporta gaps en 3 categorías.
 */
const fs = require('fs');

const zoho = JSON.parse(fs.readFileSync('C:/Users/ptoral/.claude/projects/c--Users-ptoral-Projects/e0d07a79-3c03-4805-8a46-284990148643/tool-results/mcp-zoho-crm-data-insights-ZohoCRM_getFields-1779561036689.txt', 'utf8'));
const zohoFields = new Map();
for (const f of (zoho.fields || zoho.data || [])) {
  zohoFields.set(f.api_name, {
    label: f.field_label,
    type: f.data_type,
    readonly: f.formula === true && f.data_type === 'formula'
  });
}

const code = fs.readFileSync('C:/Users/ptoral/Projects/propyte-crm/src/lib/zoho/field-maps.ts', 'utf8');
const devSectionMatch = code.match(/DEVELOPMENT_FIELDS:[^=]*=\s*\[([\s\S]*?)\];/);
const devMappings = new Map();
if (devSectionMatch) {
  const re = /\{\s*supabase:\s*"([^"]+)"\s*,\s*zoho:\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(devSectionMatch[1])) !== null) {
    if (!devMappings.has(m[1])) devMappings.set(m[1], []);
    devMappings.get(m[1]).push(m[2]);
  }
}

const supabaseCols = [
  'id','legacy_id','nombre_desarrollo','ext_slug_desarrollo','tipo_desarrollo','etapa_construccion',
  'avance_obra_porcentaje','fecha_entrega','ext_fecha_entrega_texto','unidades_totales','unidades_disponibles',
  'fases_totales','fase_actual','tasa_absorcion','arquitecto','concepto_diseno','url_drive_general',
  'fotos_desarrollo','lista_precios','brochure_pdf','tour_virtual_desarrollo','masterplan','video_desarrollo',
  'ext_og_image_desarrollo','ext_precio_min_mxn','ext_precio_max_mxn','ext_moneda','ext_roi_proyectado',
  'ext_roi_renta_mensual','ext_roi_apreciacion','ext_enganche_porcentaje','ext_meses_financiamiento','ext_tasa_interes',
  'ext_descripcion_es','ext_descripcion_en','ext_descripcion_corta_es','ext_descripcion_corta_en','ext_texto_brochure',
  'ext_meta_title_desarrollo','ext_meta_description_desarrollo','ext_keywords','ext_destacado','ext_publicado',
  'pais','estado','municipio','ciudad','colonia','calle','ext_numero_exterior','ext_numero_interior','codigo_postal',
  'latitud','longitud','zona','link_maps','ext_referencias_ubicacion','playa_distancia','aeropuerto_nombre',
  'aeropuerto_distancia','supermercado_distancia','hospital_distancia','puntos_interes',
  'amenidad_alberca_privada','amenidad_alberca_comunitaria','amenidad_gym','amenidad_salon_eventos',
  'amenidad_coworking','amenidad_rooftop','amenidad_fire_pit','amenidad_yoga','amenidad_jardin_privado',
  'amenidad_jardin_comunitario','amenidad_spa','amenidad_restaurante','amenidad_concierge','amenidad_seguridad_24h',
  'amenidad_cctv','amenidad_acceso_controlado','amenidad_lobby','amenidad_elevador','amenidad_bodega',
  'amenidad_pet_zone','amenidad_cancha','amenidad_area_ninos','ext_amenidad_juice_bar','ext_amenidad_service_room',
  'amenidades_adicionales','ext_crm_relationship','ext_commission_rate','ext_reserved_units','ext_sold_units',
  'ext_property_types','ext_usage','ext_badge','ext_plaza','ext_contacto_nombre','ext_contacto_telefono',
  'ext_detection_source','ext_source_url','ext_detected_at','id_desarrollador','created_at','updated_at','deleted_at',
  'zoho_pipeline_status','zoho_record_id','zoho_last_synced_at','zoho_sync_error','approved_at','approved_by',
  'ext_content_es','ext_content_en','ext_content_fr','ext_scraper_first_seen_at','ext_scraper_last_seen_at',
  'ext_scraper_published_at','ext_content_hashes','ext_google_maps_url','ext_ai_enriched_at','genesis_status',
  'web_status','foto_portada','ext_region','playa_distancia_valor','playa_distancia_unidad','aeropuerto_distancia_valor',
  'aeropuerto_distancia_unidad','supermercado_distancia_valor','supermercado_distancia_unidad','hospital_distancia_valor',
  'hospital_distancia_unidad','content_features_es','content_features_en','content_location_es','content_location_en',
  'content_lifestyle_es','content_lifestyle_en','faq_es','faq_en','pipeline_status','titulo_publicacion',
  'brochure_pdf_en','carpeta_imagenes_url','carpeta_imagenes_2_url','plano_url'
];

const sysCols = new Set([
  'id','legacy_id','created_at','updated_at','deleted_at',
  'zoho_record_id','zoho_last_synced_at','zoho_sync_error','zoho_pipeline_status',
  'approved_at','approved_by','ext_scraper_first_seen_at','ext_scraper_last_seen_at',
  'ext_scraper_published_at','ext_content_hashes','ext_ai_enriched_at','ext_detection_source',
  'ext_detected_at','genesis_status','web_status','pipeline_status'
]);
const hubOnlyCols = new Set([
  'ext_descripcion_en','ext_descripcion_corta_en','content_features_en','content_location_en','content_lifestyle_en',
  'ext_content_es','ext_content_en','ext_content_fr','faq_es','faq_en',
  'amenidad_alberca_privada','amenidad_alberca_comunitaria','amenidad_gym','amenidad_salon_eventos',
  'amenidad_coworking','amenidad_rooftop','amenidad_fire_pit','amenidad_yoga','amenidad_jardin_privado',
  'amenidad_jardin_comunitario','amenidad_spa','amenidad_restaurante','amenidad_concierge','amenidad_seguridad_24h',
  'amenidad_cctv','amenidad_acceso_controlado','amenidad_lobby','amenidad_elevador','amenidad_bodega',
  'amenidad_pet_zone','amenidad_cancha','amenidad_area_ninos','ext_amenidad_juice_bar','ext_amenidad_service_room',
  'ext_keywords','ext_property_types'
]);

console.log('\n=== AUDITORÍA Propyte_desarrollos ↔ Zoho.Proyectos_Inmobiliarios ===\n');

const mappedCols = new Set(devMappings.keys());
const gaps = [];
for (const col of supabaseCols) {
  if (sysCols.has(col) || hubOnlyCols.has(col)) continue;
  if (!mappedCols.has(col)) gaps.push(col);
}
console.log('⚠️ Columnas Supabase SIN mapeo a Zoho (potenciales gaps):');
for (const c of gaps) console.log('  - ' + c);

console.log('\n🔥 Mappings rotos (Zoho api_name no existe):');
let broken = 0;
for (const [sb, zo] of devMappings) {
  for (const z of zo) {
    if (!zohoFields.has(z)) { console.log('  - ' + sb + ' → ' + z); broken++; }
  }
}
if (broken === 0) console.log('  (ninguno ✅)');

const usedZoho = new Set();
for (const arr of devMappings.values()) for (const z of arr) usedZoho.add(z);
const systemZoho = new Set([
  'id','Created_Time','Modified_Time','Created_By','Modified_By','Tag','Record_Image',
  'Locked__s','Owner','Last_Activity_Time','Last_Enriched_Time__s','Enrich_Status__s',
  'Currency','Exchange_Rate'
]);
const internalPrefixes = ['$','ACTUALIZAR','Empresa','Contacto_de_Empresa','Data_','Unsubscribed_','Change_Log_'];
const zohoUnused = [];
for (const [name, info] of zohoFields) {
  if (usedZoho.has(name)) continue;
  if (systemZoho.has(name)) continue;
  if (internalPrefixes.some(p => name.startsWith(p))) continue;
  if (info.readonly) continue;
  zohoUnused.push(name + ' (' + info.type + ') = "' + info.label + '"');
}
console.log('\n📦 Fields Zoho que NO leen de Supabase (' + zohoUnused.length + '):');
for (const f of zohoUnused.slice(0, 60)) console.log('  - ' + f);
if (zohoUnused.length > 60) console.log('  ...y ' + (zohoUnused.length - 60) + ' más');

console.log('\n=== Resumen ===');
console.log('Mapeos activos:', mappedCols.size);
console.log('Gaps Supabase→Zoho:', gaps.length);
console.log('Mappings rotos:', broken);
console.log('Fields Zoho sin uso:', zohoUnused.length);
