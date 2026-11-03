// ============================================================
// Diccionario único de etiquetas en español (E1 #962)
//
// Por qué existe: en Configuración se veían enums crudos (TEAM_LEADER, ROUND_ROBIN,
// CURRENCY…). Este archivo es el punto único para traducirlos; no dupliques etiquetas
// en componentes.
//
// API pública (estable):
//   - Reexporta de constants.ts: ROLE_LABELS, PLAZA_LABELS, LEAD_SOURCE_LABELS,
//     CONTACT_TYPE_LABELS, LEAD_TEMPERATURE_LABELS, STAGE_LABELS, LIFECYCLE_LABELS,
//     CONTACT_STATUS_LABELS, DEAL_TYPE_LABELS, ACTIVITY_TYPE_LABELS, LOST_REASON_LABELS,
//     DEVELOPMENT_STATUS_LABELS, UNIT_STATUS_LABELS, CURRENCY_LABELS.
//   - Nuevos (todos Record<string, string>, alineados con prisma/schema.prisma):
//     ROLE_LABELS_COMPLETO (UserRole completo), TEAM_ROLE_LABELS, TERRITORY_TYPE_LABELS,
//     ROUTING_STRATEGY_LABELS, AUTONOMY_LABELS, FIELD_TYPE_LABELS,
//     PREFERRED_LANGUAGE_LABELS, PROPERTY_TYPE_LABELS.
//   - etiqueta(dict, value, fallback?) → string
//       Etiqueta del valor; si no está en el diccionario devuelve el valor "humanizado"
//       (UPPER_SNAKE → "Upper snake"); si value es null/undefined/"" devuelve fallback ("—").
//   - opciones(dict) → { value, label }[] ordenado por label (es), para <select>.
//
// Para avisos usa toast(); para confirmaciones useConfirm(). Aquí solo texto.
// ============================================================

import { ROLE_LABELS } from "@/lib/constants"

export {
  ROLE_LABELS,
  PLAZA_LABELS,
  LEAD_SOURCE_LABELS,
  CONTACT_TYPE_LABELS,
  LEAD_TEMPERATURE_LABELS,
  STAGE_LABELS,
  LIFECYCLE_LABELS,
  CONTACT_STATUS_LABELS,
  DEAL_TYPE_LABELS,
  ACTIVITY_TYPE_LABELS,
  LOST_REASON_LABELS,
  DEVELOPMENT_STATUS_LABELS,
  UNIT_STATUS_LABELS,
  CURRENCY_LABELS,
} from "@/lib/constants"

// enum UserRole. constants.ts solo traía los roles legados; los cuatro nuevos
// (ADMIN, ASESOR, BROKER, MANTENIMIENTO) se agregan aquí sin tocar ese objeto.
export const ROLE_LABELS_COMPLETO: Record<string, string> = {
  ...ROLE_LABELS,
  ADMIN: "Administrador",
  ASESOR: "Asesor",
  BROKER: "Broker",
  MANTENIMIENTO: "Mantenimiento",
}

// enum TeamRole
export const TEAM_ROLE_LABELS: Record<string, string> = {
  LEADER: "Líder",
  SENIOR: "Senior",
  JUNIOR: "Junior",
  HOSTESS: "Hostess",
}

// enum TerritoryType
export const TERRITORY_TYPE_LABELS: Record<string, string> = {
  GEO: "Geográfico",
  SEGMENT: "Por segmento",
}

// enum LeadAssignmentMode
export const ROUTING_STRATEGY_LABELS: Record<string, string> = {
  ROUND_ROBIN: "Turno (round-robin)",
  PERFORMANCE: "Menor carga",
  GUARDIA: "Guardia",
  MANUAL: "Manual",
}

// enum AutonomyLevel. En el schema solo existen L0-L2 (no hay L3); textos alineados con
// el selector de bot-config-tab.tsx.
export const AUTONOMY_LABELS: Record<string, string> = {
  L0: "Solo sugiere",
  L1: "Pide aprobación",
  L2: "Automático",
}

// enum FieldType (campos personalizados)
export const FIELD_TYPE_LABELS: Record<string, string> = {
  TEXT: "Texto",
  TEXTAREA: "Texto largo",
  NUMBER: "Número",
  CURRENCY: "Moneda",
  PERCENT: "Porcentaje",
  DATE: "Fecha",
  DATETIME: "Fecha y hora",
  BOOLEAN: "Sí/No",
  EMAIL: "Correo",
  PHONE: "Teléfono",
  URL: "Enlace (URL)",
  PICKLIST: "Lista de opciones",
  MULTI_PICKLIST: "Lista de opciones (múltiple)",
  AUTO_NUMBER: "Numeración automática",
  FORMULA: "Fórmula",
  FILE: "Archivo",
  USER: "Usuario",
  LOOKUP: "Relación (lookup)",
  MASTER_DETAIL: "Relación maestro-detalle",
  ROLLUP: "Resumen (rollup)",
  GEO: "Ubicación",
}

// enum PreferredLanguage
export const PREFERRED_LANGUAGE_LABELS: Record<string, string> = {
  ES: "Español",
  EN: "Inglés",
}

// enum PropertyType
export const PROPERTY_TYPE_LABELS: Record<string, string> = {
  DEPARTAMENTO: "Departamento",
  CASA: "Casa",
  TERRENO: "Terreno",
  MACROLOTE: "Macrolote",
  LOCAL_COMERCIAL: "Local comercial",
  OTRO: "Otro",
}

// "TEAM_LEADER" → "Team leader"; "snake_case" → "Snake case"
function humanizar(raw: string): string {
  const limpio = raw.replace(/[_\-\s]+/g, " ").trim().toLowerCase()
  return limpio.charAt(0).toUpperCase() + limpio.slice(1)
}

export function etiqueta(
  dict: Record<string, string>,
  value: string | null | undefined,
  fallback = "—",
): string {
  if (value === null || value === undefined || value === "") return fallback
  // hasOwn: evita que "constructor" o "toString" devuelvan funciones del prototipo
  return Object.prototype.hasOwnProperty.call(dict, value) ? dict[value] : humanizar(value)
}

export function opciones(dict: Record<string, string>): { value: string; label: string }[] {
  return Object.entries(dict)
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "es"))
}
