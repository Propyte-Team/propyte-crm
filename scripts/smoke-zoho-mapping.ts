// Smoke test del refactor Fase 6 — sin BD, sin Zoho API.
// Verifica que:
//  1. developmentToZoho emite Pipeline_Status + Keywords_SEO + Tipos_propiedad.
//  2. unitToZoho hace fallback de Cover_image_URL al primer foto.
//  3. zohoProyectoToSupabase round-trip preserva campos clave.
//  4. pipelineSourceOfTruth devuelve gating correcto.

import {
  developmentToZoho,
  unitToZoho,
  zohoProyectoToSupabase,
} from "@/lib/zoho/field-maps";
import { pipelineSourceOfTruth } from "@/lib/zoho/types";

const devFixture = {
  id: "test-uuid-1",
  nombre_desarrollo: "Test Tower Tulum",
  ext_slug_desarrollo: "test-tower-tulum",
  ext_meta_title_desarrollo: "Test Tower - Tulum",
  ext_meta_description_desarrollo: "Lujo en Tulum",
  ext_descripcion_es: "Desarrollo de lujo frente al mar",
  ext_descripcion_corta_es: "Lujo frente al mar",
  content_features_es: "Acceso privado a playa, gym, spa",
  content_location_es: "A 5 min de la 5ta avenida",
  content_lifestyle_es: "Wellness mediterráneo",
  pipeline_status: "Publicado",
  tipo_desarrollo: "Vertical",
  etapa_construccion: "Preventa",
  avance_obra_porcentaje: 35,
  fecha_entrega: "2027-06-15",
  unidades_totales: 80,
  ext_reserved_units: 12,
  ext_sold_units: 8,
  arquitecto: "Estudio Macías",
  concepto_diseno: "Tropical minimal",
  ext_precio_min_mxn: 5_500_000,
  ext_precio_max_mxn: 18_000_000,
  ext_roi_proyectado: 12.5,
  ext_destacado: true,
  ext_publicado: true,
  pais: "Mexico",
  estado: "Quintana Roo",
  municipio: "Tulum",
  zona: "Aldea Zama",
  latitud: 20.2052,
  longitud: -87.4631,
  foto_portada: "https://cdn.propyte.com/dev/cover.jpg",
  brochure_pdf: "https://cdn.propyte.com/dev/brochure.pdf",
  ext_keywords: ["tulum", "preventa", "lujo"],
  ext_property_types: ["Departamento", "Penthouse"],
  ext_commission_rate: 0.06,
};

const zd = developmentToZoho(devFixture);
console.log("=== Zoho payload Proyecto_Inmobiliario ===");
console.log(JSON.stringify(zd, null, 2));

console.log("\n=== Round-trip Zoho → Supabase ===");
const zohoRecord = {
  ...zd,
  id: "z-1",
  Modified_Time: "2026-05-22T12:00:00Z",
} as any;
const back = zohoProyectoToSupabase(zohoRecord);
console.log(JSON.stringify(back, null, 2));

const unitFixture = {
  id: "test-unit-1",
  titulo_unidad: "Penthouse A-501",
  slug_unidad: "test-tower-ph-a-501",
  pipeline_status: "Borrador",
  estado_unidad: "Disponible",
  superficie_construida_m2: 145.5,
  superficie_terreno_m2: 12.0,
  banos_completos: 2,
  recamaras: 3,
  medios_banos: 1,
  precio_mxn: 8_500_000,
  precio_usd: 510_000,
  ext_tiene_alberca: true,
  es_destacada_unidad: true,
  content_features_es: "Vista mar, terraza 50m",
  foto_portada_unidad: "",
  fotos_unidad: ["https://cdn.propyte.com/units/501-1.jpg"],
  keywords_unidad: ["tulum", "penthouse"],
};

const zu = unitToZoho(unitFixture, "z-1");
console.log("\n=== Zoho payload Product ===");
console.log(JSON.stringify(zu, null, 2));

console.log("\n=== Source-of-truth gating ===");
const statuses: Array<string | null> = [
  "Borrador",
  "Revision",
  "Publicado",
  "Rechazado",
  "Terminado",
  null,
  "discovery",
];
for (const s of statuses) {
  console.log(`  ${s ?? "null"} → ${pipelineSourceOfTruth(s as any)}`);
}

// Aserciones mínimas
const assert = (cond: unknown, msg: string) => {
  if (!cond) {
    console.error("ASSERT FAIL:", msg);
    process.exit(1);
  }
};

assert(zd.Pipeline_Status === "Publicado", "Pipeline_Status set");
assert(zd.Keywords_SEO === "tulum, preventa, lujo", "Keywords_SEO joined");
assert(
  Array.isArray(zd.Tipos_propiedad) && zd.Tipos_propiedad.length === 2,
  "Tipos_propiedad multiselect array"
);
assert(zd.Cover_image_URL === "https://cdn.propyte.com/dev/cover.jpg", "Cover from foto_portada");
assert(zd.Pa_s === "Mexico", "País default");
assert(zd.Avance_obra === 35, "Avance obra number");

assert(back.pipeline_status === "Publicado", "Round-trip pipeline_status");
assert(back.ext_descripcion_es === devFixture.ext_descripcion_es, "Round-trip descripcion");
assert(back.content_features_es === devFixture.content_features_es, "Round-trip content_features FLAT");
assert(
  Array.isArray(back.ext_keywords) && (back.ext_keywords as string[]).length === 3,
  "Round-trip keywords parsed"
);

assert(zu.Pipeline_Status === "Borrador", "Unit Pipeline_Status");
assert(
  zu.Cover_image_URL === "https://cdn.propyte.com/units/501-1.jpg",
  "Unit Cover fallback to first foto"
);
assert(zu.Rec_maras === "3", "Recamaras as TEXT");
assert(zu.Ba_os === "2", "Banos as TEXT");
assert(zu.Alberca === "Sí", "Alberca picklist Sí");
assert(zu.Desarrollo && (zu.Desarrollo as any).id === "z-1", "Desarrollo lookup");
assert(zu.Proyecto_inmobiliario && (zu.Proyecto_inmobiliario as any).id === "z-1", "Legacy lookup preserved");

assert(pipelineSourceOfTruth("Borrador") === "zoho", "SOT Borrador → zoho");
assert(pipelineSourceOfTruth("Publicado") === "hub", "SOT Publicado → hub");
assert(pipelineSourceOfTruth("discovery") === "none", "SOT legacy → none");

console.log("\n✅ All assertions passed.");
