// Etiquetas en español del perfil de inversión del contacto. Vivían como constantes locales de
// la ficha (contact-detail.tsx); se movieron aquí (#901) porque la exportación de contactos
// también las necesita y una segunda copia a mano es justo la que se desincroniza.
export const INVESTMENT_LABEL: Record<string, string> = {
  END_USER: "Usuario final",
  INVESTOR_RENTAL: "Inversionista (renta)",
  INVESTOR_FLIP: "Inversionista (flip)",
  INVESTOR_LAND: "Inversionista (terreno)",
  MIXED: "Mixto",
};
export const PROPERTY_LABEL: Record<string, string> = {
  DEPARTAMENTO: "Departamento",
  CASA: "Casa",
  TERRENO: "Terreno",
  MACROLOTE: "Macrolote",
  LOCAL_COMERCIAL: "Local comercial",
  OTRO: "Otro",
};
export const TIMELINE_LABEL: Record<string, string> = {
  IMMEDIATE: "Inmediato",
  ONE_TO_THREE_MONTHS: "1-3 meses",
  THREE_TO_SIX_MONTHS: "3-6 meses",
  SIX_PLUS_MONTHS: "6+ meses",
};
export const PAYMENT_LABEL: Record<string, string> = {
  CONTADO: "Contado",
  CREDITO_HIPOTECARIO: "Crédito hipotecario",
  FINANCIAMIENTO_DIRECTO: "Financiamiento directo",
  MIXTO: "Mixto",
};
export const MODALITY_LABEL: Record<string, string> = {
  PREVENTA: "Preventa",
  ENTREGA_INMEDIATA: "Entrega inmediata",
  REVENTA: "Reventa",
  ABIERTO: "Abierto",
};
export const RENTAL_LABEL: Record<string, string> = {
  LONG_TERM: "Largo plazo",
  AIRBNB: "Airbnb / corto plazo",
  BOTH: "Ambos",
  NA: "No aplica",
};
