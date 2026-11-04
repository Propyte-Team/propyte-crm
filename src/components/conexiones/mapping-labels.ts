// Etiquetas en español para el editor de mapeo (E1 #962). Reutiliza `@/lib/labels`; solo agrega
// lo que ahí no existe (campos destino, metadatos de Meta y enums propios del alta de leads).
import {
  CONTACT_TYPE_LABELS,
  LEAD_SOURCE_LABELS,
  LEAD_TEMPERATURE_LABELS,
  PROPERTY_TYPE_LABELS,
  etiqueta,
} from "@/lib/labels"

export const DESTINO_LABELS: Record<string, string> = {
  firstName: "Nombre",
  lastName: "Apellido",
  fullName: "Nombre completo",
  phone: "Teléfono",
  email: "Correo",
  source: "Fuente",
  sourceDetail: "Detalle de la fuente",
  language: "Idioma",
  contactType: "Tipo de contacto",
  temperature: "Temperatura",
  investmentProfile: "Perfil de inversión",
  propertyType: "Tipo de propiedad",
  purchaseTimeline: "Plazo de compra",
  paymentMethod: "Forma de pago",
  purchaseModality: "Modalidad de compra",
  rentalStrategy: "Estrategia de renta",
  budgetMin: "Presupuesto mínimo",
  budgetMax: "Presupuesto máximo",
  preferredZone: "Zona de interés",
  notes: "Notas",
}

export const METADATA_LABELS: Record<string, string> = {
  campaign_name: "Nombre de la campaña",
  campaign_id: "ID de la campaña",
  adset_name: "Nombre del conjunto de anuncios",
  adset_id: "ID del conjunto de anuncios",
  ad_name: "Nombre del anuncio",
  ad_id: "ID del anuncio",
  form_id: "ID del formulario",
  leadgen_id: "ID del prospecto en Meta",
}

const INVERSION: Record<string, string> = {
  END_USER: "Para vivir",
  INVESTOR_RENTAL: "Inversión para renta",
  INVESTOR_FLIP: "Inversión para reventa",
  INVESTOR_LAND: "Inversión en terreno",
  MIXED: "Mixto",
}
const PLAZO: Record<string, string> = {
  IMMEDIATE: "Inmediato",
  ONE_TO_THREE_MONTHS: "De 1 a 3 meses",
  THREE_TO_SIX_MONTHS: "De 3 a 6 meses",
  SIX_PLUS_MONTHS: "Más de 6 meses",
}
const PAGO: Record<string, string> = {
  CONTADO: "Contado",
  CREDITO_HIPOTECARIO: "Crédito hipotecario",
  FINANCIAMIENTO_DIRECTO: "Financiamiento directo",
  MIXTO: "Mixto",
}
const MODALIDAD: Record<string, string> = {
  PREVENTA: "Preventa",
  ENTREGA_INMEDIATA: "Entrega inmediata",
  REVENTA: "Reventa",
  ABIERTO: "Abierto",
}
const RENTA: Record<string, string> = {
  LONG_TERM: "Renta a largo plazo",
  AIRBNB: "Renta vacacional",
  BOTH: "Ambas",
  NA: "No aplica",
}

const VALORES_POR_DESTINO: Record<string, Record<string, string>> = {
  contactType: CONTACT_TYPE_LABELS,
  temperature: LEAD_TEMPERATURE_LABELS,
  source: LEAD_SOURCE_LABELS,
  investmentProfile: INVERSION,
  propertyType: PROPERTY_TYPE_LABELS,
  purchaseTimeline: PLAZO,
  paymentMethod: PAGO,
  purchaseModality: MODALIDAD,
  rentalStrategy: RENTA,
}

/** Etiqueta de un valor de enum para un destino; sin diccionario, humaniza el valor. */
export function etiquetaValorEnum(target: string, value: string): string {
  return etiqueta(VALORES_POR_DESTINO[target] ?? {}, value)
}

/** «fullName» → «Nombre completo»; «custom.presupuesto» → «Campo personalizado: presupuesto». */
export function etiquetaDestino(target: string): string {
  if (!target) return ""
  if (target.startsWith("custom.")) return `Campo personalizado: ${target.slice(7)}`
  return DESTINO_LABELS[target] ?? etiqueta({}, target.replace(/([A-Z])/g, " $1"))
}
