// Exportación de contactos a CSV (#901): botón «Descargar usuarios» de la lista de Contactos.
// Módulo PURO (sin Prisma ni sesión): quién puede exportar, el catálogo de datos que se pueden
// elegir y cómo se arma el archivo. La ruta /api/contacts/export hace la consulta y el registro.

import {
  CONTACT_STATUS_LABELS,
  CONTACT_TYPE_LABELS,
  LEAD_SOURCE_LABELS,
  LEAD_TEMPERATURE_LABELS,
  LIFECYCLE_LABELS,
  PLAZA_LABELS,
  URGENCY_LABELS,
} from "@/lib/constants";
import { CANCUN_TZ } from "@/lib/format-date";
import { etiquetaFlujo } from "@/lib/flujos";
import {
  INVESTMENT_LABEL,
  MODALITY_LABEL,
  PAYMENT_LABEL,
  PROPERTY_LABEL,
  RENTAL_LABEL,
  TIMELINE_LABEL,
} from "@/lib/contacts/perfil-labels";

/** Los únicos roles que ven el botón y que la ruta deja exportar. */
export const ROLES_EXPORTAN_CONTACTOS: readonly string[] = ["ADMIN", "DIRECTOR"];

export function puedeExportarContactos(role: string | null | undefined): boolean {
  return !!role && ROLES_EXPORTAN_CONTACTOS.includes(role);
}

/** Lo que la ruta trae de cada contacto (forma del `select` de Prisma, ya serializable). */
export interface ContactoExportable {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string;
  secondaryPhone: string | null;
  contactType: string | null;
  flujo: string | null; // #948
  contactStatus: string;
  lifecycleStage: string | null;
  temperature: string;
  score: number;
  urgency: string | null;
  tags: string[];
  leadSource: string;
  leadSourceDetail: string | null;
  targetPlaza: string | null;
  residenceCity: string | null;
  residenceCountry: string | null;
  nationality: string | null;
  preferredLanguage: string;
  investmentProfile: string | null;
  propertyType: string | null;
  purchaseTimeline: string | null;
  budgetMin: unknown; // Decimal de Prisma: se pasa por String()
  budgetMax: unknown;
  paymentMethod: string | null;
  preferredZone: string | null;
  purchaseModality: string | null;
  rentalStrategy: string | null;
  doNotContact: boolean;
  whatsappOptOut: boolean;
  createdAt: Date | string;
  lastActivityAt: Date | string | null;
  updatedAt: Date | string;
  assignedTo: { name: string; email: string } | null;
  brands: { brand: { name: string } }[];
  /** #937: campaña o evento (opcional en el tipo: los exportes viejos de prueba no lo traen). */
  campaign?: { name: string } | null;
  _count: { deals: number; activities: number };
}

export interface CampoExportacion {
  key: string;
  label: string;
  grupo: string;
  /** Marcado al abrir la ventana. */
  porDefecto?: boolean;
  /** Teléfonos: se escriben para que Excel no los convierta en número (ver celdaTelefono). */
  telefono?: boolean;
  valor: (c: ContactoExportable) => string;
}

const etiqueta = (mapa: Record<string, string>, v: string | null | undefined) => (v ? mapa[v] ?? v : "");
const texto = (v: string | null | undefined) => v ?? "";
const siNo = (v: boolean) => (v ? "Sí" : "No");
const monto = (v: unknown) => (v === null || v === undefined || v === "" ? "" : String(v));

/** Fecha y hora en horario de Cancún, formato fijo AAAA-MM-DD HH:MM (ordena bien en Excel). */
export function fechaExport(d: Date | string | null | undefined): string {
  if (!d) return "";
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: CANCUN_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(d));
  const p = (t: string) => partes.find((x) => x.type === t)?.value ?? "";
  return `${p("year")}-${p("month")}-${p("day")} ${p("hour")}:${p("minute")}`;
}

/** Orden = orden de las columnas en el archivo y de las casillas en la ventana. */
export const CAMPOS_EXPORTACION: CampoExportacion[] = [
  // Datos de contacto
  { key: "nombre", label: "Nombre", grupo: "Datos de contacto", porDefecto: true, valor: (c) => c.firstName },
  { key: "apellido", label: "Apellido", grupo: "Datos de contacto", porDefecto: true, valor: (c) => c.lastName },
  { key: "email", label: "Email", grupo: "Datos de contacto", porDefecto: true, valor: (c) => texto(c.email) },
  { key: "telefono", label: "Teléfono", grupo: "Datos de contacto", porDefecto: true, telefono: true, valor: (c) => c.phone },
  { key: "telefono2", label: "Teléfono secundario", grupo: "Datos de contacto", telefono: true, valor: (c) => texto(c.secondaryPhone) },

  // Clasificación
  { key: "tipo", label: "Tipo de contacto", grupo: "Clasificación", porDefecto: true, valor: (c) => etiqueta(CONTACT_TYPE_LABELS, c.contactType) },
  // #948: vacío sale «Sin flujo» y no en blanco, para que se vea qué falta elegir.
  { key: "flujo", label: "Flujo", grupo: "Clasificación", valor: (c) => etiquetaFlujo(c.flujo) },
  { key: "estado", label: "Estado", grupo: "Clasificación", porDefecto: true, valor: (c) => etiqueta(CONTACT_STATUS_LABELS, c.contactStatus) },
  { key: "etapa", label: "Etapa del ciclo de vida", grupo: "Clasificación", valor: (c) => etiqueta(LIFECYCLE_LABELS, c.lifecycleStage) },
  { key: "temperatura", label: "Temperatura", grupo: "Clasificación", porDefecto: true, valor: (c) => etiqueta(LEAD_TEMPERATURE_LABELS, c.temperature) },
  { key: "puntuacion", label: "Puntuación", grupo: "Clasificación", valor: (c) => String(c.score) },
  { key: "urgencia", label: "Urgencia", grupo: "Clasificación", valor: (c) => etiqueta(URGENCY_LABELS, c.urgency) },
  { key: "etiquetas", label: "Etiquetas", grupo: "Clasificación", valor: (c) => c.tags.join(", ") },

  // Origen y asignación
  { key: "fuente", label: "Fuente", grupo: "Origen y asignación", porDefecto: true, valor: (c) => etiqueta(LEAD_SOURCE_LABELS, c.leadSource) },
  { key: "fuenteDetalle", label: "Detalle de la fuente", grupo: "Origen y asignación", valor: (c) => texto(c.leadSourceDetail) },
  { key: "campana", label: "Campaña o evento", grupo: "Origen y asignación", valor: (c) => c.campaign?.name ?? "" }, // #937
  { key: "marcas", label: "Marca", grupo: "Origen y asignación", porDefecto: true, valor: (c) => c.brands.map((b) => b.brand.name).join(", ") },
  { key: "plaza", label: "Plaza", grupo: "Origen y asignación", valor: (c) => etiqueta(PLAZA_LABELS, c.targetPlaza) },
  { key: "asesor", label: "Asesor asignado", grupo: "Origen y asignación", porDefecto: true, valor: (c) => c.assignedTo?.name ?? "" },
  { key: "asesorEmail", label: "Email del asesor", grupo: "Origen y asignación", valor: (c) => c.assignedTo?.email ?? "" },

  // Ubicación
  { key: "ciudad", label: "Ciudad", grupo: "Ubicación", valor: (c) => texto(c.residenceCity) },
  { key: "pais", label: "País", grupo: "Ubicación", valor: (c) => texto(c.residenceCountry) },
  { key: "nacionalidad", label: "Nacionalidad", grupo: "Ubicación", valor: (c) => texto(c.nationality) },
  { key: "idioma", label: "Idioma", grupo: "Ubicación", valor: (c) => (c.preferredLanguage === "EN" ? "Inglés" : "Español") },

  // Perfil de inversión
  { key: "perfil", label: "Perfil de inversión", grupo: "Perfil de inversión", valor: (c) => etiqueta(INVESTMENT_LABEL, c.investmentProfile) },
  { key: "tipoPropiedad", label: "Tipo de propiedad", grupo: "Perfil de inversión", valor: (c) => etiqueta(PROPERTY_LABEL, c.propertyType) },
  { key: "plazo", label: "Plazo de compra", grupo: "Perfil de inversión", valor: (c) => etiqueta(TIMELINE_LABEL, c.purchaseTimeline) },
  { key: "presupuestoMin", label: "Presupuesto mínimo", grupo: "Perfil de inversión", valor: (c) => monto(c.budgetMin) },
  { key: "presupuestoMax", label: "Presupuesto máximo", grupo: "Perfil de inversión", valor: (c) => monto(c.budgetMax) },
  { key: "pago", label: "Forma de pago", grupo: "Perfil de inversión", valor: (c) => etiqueta(PAYMENT_LABEL, c.paymentMethod) },
  { key: "zona", label: "Zona preferida", grupo: "Perfil de inversión", valor: (c) => texto(c.preferredZone) },
  { key: "modalidad", label: "Modalidad", grupo: "Perfil de inversión", valor: (c) => etiqueta(MODALITY_LABEL, c.purchaseModality) },
  { key: "renta", label: "Estrategia de renta", grupo: "Perfil de inversión", valor: (c) => etiqueta(RENTAL_LABEL, c.rentalStrategy) },

  // Permisos de contacto
  { key: "noContactar", label: "No contactar", grupo: "Permisos de contacto", valor: (c) => siNo(c.doNotContact) },
  { key: "bajaWhatsapp", label: "Baja de WhatsApp", grupo: "Permisos de contacto", valor: (c) => siNo(c.whatsappOptOut) },

  // Actividad
  { key: "negocios", label: "Negocios", grupo: "Actividad", valor: (c) => String(c._count.deals) },
  { key: "actividades", label: "Actividades", grupo: "Actividad", valor: (c) => String(c._count.activities) },
  { key: "registro", label: "Fecha de registro", grupo: "Actividad", porDefecto: true, valor: (c) => fechaExport(c.createdAt) },
  { key: "ultimaActividad", label: "Última actividad", grupo: "Actividad", valor: (c) => fechaExport(c.lastActivityAt) },
  { key: "modificado", label: "Última modificación", grupo: "Actividad", valor: (c) => fechaExport(c.updatedAt) },
];

/** Claves pedidas → campos del catálogo, en el orden del catálogo. Las desconocidas se ignoran. */
export function camposElegidos(keys: readonly string[]): CampoExportacion[] {
  const pedidas = new Set(keys);
  return CAMPOS_EXPORTACION.filter((c) => pedidas.has(c.key));
}

/**
 * Celda de texto segura para Excel. Los datos vienen de prospectos (formularios, chats), así
 * que un valor que empieza con = + - @ (o tabulador/retorno) se ejecutaría como fórmula al abrir
 * el archivo («inyección de CSV»). Se le antepone un apóstrofo, que Excel y Sheets toman como
 * «esto es texto». Después se escapa para CSV (comillas dobles).
 */
export function celdaTexto(v: string): string {
  const seguro = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return `"${seguro.replace(/"/g, '""')}"`;
}

/**
 * Teléfono: escrito tal cual, Excel lo convierte en número («+529861053947» → 5.29861E+11) y se
 * pierden el «+» y los dígitos. Se escribe como la fórmula de texto ="…", que Excel, Sheets y
 * LibreOffice muestran exacto. Es seguro porque solo se dejan pasar «+» y dígitos: cualquier
 * otro carácter se quita antes, así que no se puede colar una fórmula de verdad.
 */
export function celdaTelefono(v: string): string {
  const limpio = v.replace(/[^\d+]/g, "");
  return limpio ? `"=""${limpio}"""` : '""';
}

/** El archivo completo: BOM UTF-8 (para que Excel lea acentos), encabezados y una fila por contacto. */
export function construirCsv(contactos: readonly ContactoExportable[], campos: readonly CampoExportacion[]): string {
  const encabezados = campos.map((c) => celdaTexto(c.label)).join(",");
  const filas = contactos.map((contacto) =>
    campos.map((c) => (c.telefono ? celdaTelefono(c.valor(contacto)) : celdaTexto(c.valor(contacto)))).join(","),
  );
  return "﻿" + [encabezados, ...filas].join("\r\n") + "\r\n";
}

/** Nombre del archivo con la fecha de Cancún: contactos-AAAA-MM-DD.csv */
export function nombreArchivoExport(ahora: Date = new Date()): string {
  return `contactos-${fechaExport(ahora).slice(0, 10)}.csv`;
}
