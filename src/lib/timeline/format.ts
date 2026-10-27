import {
  CONTACT_STATUS_LABELS,
  LEAD_TEMPERATURE_LABELS,
  LIFECYCLE_LABELS,
  CONTACT_TYPE_LABELS,
  LEAD_SOURCE_LABELS,
  URGENCY_LABELS,
  PLAZA_LABELS,
} from "@/lib/constants";
import { ETIQUETAS_CAMPOS_ADICIONALES } from "@/lib/contacts/campos-adicionales";
import { CORE_FIELDS } from "@/lib/metadata/core-fields-catalogo";
import {
  INVESTMENT_LABEL,
  MODALITY_LABEL,
  PAYMENT_LABEL,
  PROPERTY_LABEL,
  RENTAL_LABEL,
  TIMELINE_LABEL,
} from "@/lib/contacts/perfil-labels";

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

// Label de campo estilo Zoho ("Estado de contacto se actualizó de X a Y").
// #934: antes, todo lo que no estaba en esta lista salía con su nombre técnico («firstName
// se actualizó…», «phone…»: ~1,000 renglones medidos el 27-oct). Ahora el orden es:
//   1. FIELD_LABELS (los textos propios de la cronología, p. ej. «Asignado a»);
//   2. el catálogo de campos core (CORE_FIELDS), el mismo que usa la ficha y los permisos;
//   3. columnas que no están en el catálogo pero sí cambian (CAMPOS_SOLO_CRONOLOGIA);
//   4. el nombre del campo pasado a palabras («fooBar» → «Foo bar»), nunca camelCase crudo.
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
  referredById: "Registrado por", // #907/#929: la ruta resuelve el id al nombre del broker
  ...ETIQUETAS_CAMPOS_ADICIONALES, // #914
  email: "Correo", // la ficha dice «Email»; en la frase se lee mejor «Correo se actualizó…»
};

/** Columnas del contacto que no son campos editables de la ficha pero sí aparecen en la cronología. */
const CAMPOS_SOLO_CRONOLOGIA: Record<string, string> = {
  targetPlaza: "Plaza",
  messengerPsid: "Usuario de Messenger",
  instagramId: "Usuario de Instagram",
  doNotContact: "No contactar",
  whatsappOptOut: "Baja de WhatsApp",
  recordingConsent: "Consentimiento de grabación",
  mergedIntoId: "Fusionado en",
  originalCreatedAt: "Fecha de creación original",
  zohoId: "ID de Zoho",
  hubContactId: "ID del Hub",
};

const ETIQUETAS_CORE: Record<string, string> = Object.fromEntries(
  (CORE_FIELDS.contact ?? []).map((f) => [f.key, f.label]),
);

/** «targetPlaza» → «Target plaza»; «doNot_contact» → «Do not contact». Último recurso. */
function aPalabras(campo: string): string {
  const t = campo
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-.]+/g, " ")
    .trim()
    .toLowerCase();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : campo;
}

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
  // #934: el perfil de inversión y la plaza salían como INVESTOR_RENTAL, ONE_TO_THREE_MONTHS, TULUM…
  investmentProfile: INVESTMENT_LABEL,
  propertyType: PROPERTY_LABEL,
  purchaseTimeline: TIMELINE_LABEL,
  paymentMethod: PAYMENT_LABEL,
  purchaseModality: MODALITY_LABEL,
  rentalStrategy: RENTAL_LABEL,
  targetPlaza: PLAZA_LABELS,
};

/** Montos: se leen con separador de miles («2,000,000»), sin inventar la moneda. */
const CAMPOS_MONTO = new Set(["budgetMin", "budgetMax"]);

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? ETIQUETAS_CORE[field] ?? CAMPOS_SOLO_CRONOLOGIA[field] ?? aPalabras(field);
}

export function valueLabel(field: string, value: unknown): string {
  // #934: "" es el centinela de «sin teléfono» de captureLead; salía «de  a +52…».
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.length ? value.map((v) => valueLabel(field, v)).join(", ") : "—";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  const map = VALUE_LABEL_MAPS[field];
  if (map && typeof value === "string" && map[value]) return map[value];
  if (CAMPOS_MONTO.has(field)) {
    const n = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(n)) return n.toLocaleString("es-MX", { maximumFractionDigits: 2 });
  }
  if (typeof value === "object") return JSON.stringify(value); // nunca «[object Object]»
  return String(value);
}

export function fieldChangeTitle(field: string, oldValue: unknown, newValue: unknown): string {
  // #934: «deletedAt se actualizó de — a 2026-10-16T…» → lo que de verdad pasó.
  if (field === "deletedAt") {
    if (newValue !== null && newValue !== undefined) return "Contacto eliminado";
    if (oldValue !== null && oldValue !== undefined) return "Contacto restaurado";
  }
  return `${fieldLabel(field)} se actualizó de ${valueLabel(field, oldValue)} a ${valueLabel(field, newValue)}`;
}
