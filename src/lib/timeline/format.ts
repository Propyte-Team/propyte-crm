import {
  CONTACT_STATUS_LABELS,
  LEAD_TEMPERATURE_LABELS,
  LIFECYCLE_LABELS,
  CONTACT_TYPE_LABELS,
  LEAD_SOURCE_LABELS,
  URGENCY_LABELS,
} from "@/lib/constants";

// "3d 4h", "2h 15m", "45m", "<1m" — a la escala de días no se muestran minutos, a la
// escala de horas no se muestran segundos. Unidad con valor 0 se omite (p.ej. "2h" sin " 0m").
export function humanizeDuration(ms: number): string {
  if (ms < 60_000) return "<1m";

  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(ms / 3_600_000);
  if (hours < 24) {
    const remMinutes = Math.floor((ms % 3_600_000) / 60_000);
    return remMinutes > 0 ? `${hours}h ${remMinutes}m` : `${hours}h`;
  }

  const days = Math.floor(ms / 86_400_000);
  const remHours = Math.floor((ms % 86_400_000) / 3_600_000);
  return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
}

// Label de campo estilo Zoho ("Estado de contacto se actualizó de X a Y"). Fallback =
// nombre crudo del campo si no está mapeado (custom fields futuros, campos nuevos, etc).
const FIELD_LABELS: Record<string, string> = {
  contactStatus: "Estado de contacto",
  temperature: "Temperatura",
  assignedToId: "Asignado a",
  lifecycleStage: "Ciclo de vida",
  contactType: "Tipo de contacto",
  leadSource: "Fuente",
  urgency: "Urgencia",
  score: "Puntuación",
  tags: "Etiquetas",
  custom: "Campos personalizados",
};

// Mapas de valor→label de constants.ts, por campo. assignedToId NO tiene mapa aquí a
// propósito: requiere resolver nombres de usuario vía DB, algo que esta capa (lógica pura,
// sin acceso a Prisma) no puede hacer — el caller (la API route) resuelve los nombres y
// pasa el valor YA humanizado (p.ej. "Ana Pérez" o "Sin asignar") como oldValue/newValue.
const VALUE_LABEL_MAPS: Record<string, Record<string, string>> = {
  contactStatus: CONTACT_STATUS_LABELS,
  temperature: LEAD_TEMPERATURE_LABELS,
  lifecycleStage: LIFECYCLE_LABELS,
  contactType: CONTACT_TYPE_LABELS,
  leadSource: LEAD_SOURCE_LABELS,
  urgency: URGENCY_LABELS,
};

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

export function valueLabel(field: string, value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (Array.isArray(value)) return value.map((v) => valueLabel(field, v)).join(", ");
  const map = VALUE_LABEL_MAPS[field];
  if (map && typeof value === "string" && map[value]) return map[value];
  return String(value);
}

export function fieldChangeTitle(field: string, oldValue: unknown, newValue: unknown): string {
  return `${fieldLabel(field)} se actualizó de ${valueLabel(field, oldValue)} a ${valueLabel(field, newValue)}`;
}
