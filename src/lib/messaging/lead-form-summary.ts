// Datos de contacto en el resumen de un formulario de anuncio (2026-10-10).
//
// Por qué existe: un cliente real llegó por un anuncio de Messenger con
// formulario. Meta mete las respuestas del formulario en el primer DM como
// texto plano, una por renglón:
//
//   ¡Hola! Completé el formulario y me gustaría obtener más información…
//   ¿Cuál es tu esquema de pago?: Recurso propio
//   Last name: Melendez
//   Phone number: 55 5453 3990
//   First name: Yanush
//   Email: …
//
// y el contacto se quedó como "Messenger (por identificar)", sin teléfono ni
// correo: el asesor tenía los datos en el hilo pero no en la ficha. Aquí se
// leen esos renglones "Clave: valor" (en inglés o en español) y se decide qué
// campos de la ficha se pueden llenar. Puro: sin base ni red.
//
// Regla de oro: SOLO se llenan campos vacíos o que siguen con el placeholder
// del alta. Un dato real nunca se sobrescribe con lo que diga un mensaje.
import { z } from "zod";
import { normalizePhoneE164 } from "@/lib/phone";
import { PLACEHOLDER_LASTNAME } from "./types";

export interface LeadFormFields {
  firstName?: string;
  lastName?: string;
  /** Ya normalizado a E.164 (+52XXXXXXXXXX para un celular mexicano de 10 dígitos). */
  phone?: string;
  email?: string;
}

type Key = keyof LeadFormFields | "fullName";

// Claves ya normalizadas (minúsculas, sin acentos ni signos de pregunta).
const KEYS: Record<string, Key> = {
  "first name": "firstName",
  nombre: "firstName",
  nombres: "firstName",
  "nombre(s)": "firstName",
  "last name": "lastName",
  apellido: "lastName",
  apellidos: "lastName",
  "apellido(s)": "lastName",
  // El formulario por defecto de Meta pide "Full name" en un solo campo.
  "full name": "fullName",
  "nombre completo": "fullName",
  "phone number": "phone",
  phone: "phone",
  telefono: "phone",
  "numero de telefono": "phone",
  celular: "phone",
  "numero de celular": "phone",
  email: "email",
  "e-mail": "email",
  correo: "email",
  "correo electronico": "email",
};

const NAME_MAX = 80; // el mismo tope que incomingLeadSchema
const emailSchema = z.string().email();

function normalizeKey(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/_/g, " ") // "first_name" → "first name"
    .replace(/[¿?¡!*•]/g, "")
    .replace(/^[\s-]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Un valor de nombre creíble: tiene letras, no tiene dígitos ni arrobas ni
 * URLs, y cabe en la ficha. "Departamento de 2 recámaras" no pasa.
 */
function cleanName(raw: string): string | null {
  const v = raw.replace(/\s+/g, " ").trim();
  if (!v || v.length > NAME_MAX) return null;
  if (/\d|@|:\/\//.test(v)) return null;
  if (!/[A-Za-zÀ-ÖØ-öø-ÿ]/.test(v)) return null;
  return v;
}

/**
 * Lee los renglones "Clave: valor" de un mensaje. Devuelve null si no hay
 * ninguno reconocible y válido. La primera aparición de cada clave gana.
 */
export function parseLeadFormSummary(text: string | null | undefined): LeadFormFields | null {
  if (!text) return null;
  const out: LeadFormFields = {};
  let fullName: string | null = null;

  for (const line of text.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const key = KEYS[normalizeKey(line.slice(0, colon))];
    const value = line.slice(colon + 1).trim();
    if (!key || !value) continue;

    if (key === "firstName" || key === "lastName") {
      const name = cleanName(value);
      if (name && !out[key]) out[key] = name;
    } else if (key === "fullName") {
      fullName = fullName ?? cleanName(value);
    } else if (key === "phone") {
      const phone = normalizePhoneE164(value);
      if (phone && !out.phone) out.phone = phone;
    } else if (key === "email") {
      const email = value.toLowerCase();
      if (!out.email && emailSchema.safeParse(email).success) out.email = email;
    }
  }

  // "Full name" solo completa lo que no vino por separado.
  if (fullName) {
    const [first, ...rest] = fullName.split(" ");
    if (!out.firstName) out.firstName = first;
    if (!out.lastName && rest.length > 0) out.lastName = rest.join(" ");
  }

  return Object.keys(out).length > 0 ? out : null;
}

// Nombres que pone el alta cuando el canal no da uno real: core.ts usa
// "Instagram"/"Messenger"/"WhatsApp", y profile.ts usa "@usuario" cuando
// Instagram solo da el handle.
const PLACEHOLDER_FIRST_NAMES = new Set(["instagram", "messenger", "whatsapp"]);

export function isPlaceholderFirstName(value: string | null | undefined): boolean {
  const v = value?.trim() ?? "";
  return !v || PLACEHOLDER_FIRST_NAMES.has(v.toLowerCase()) || v.startsWith("@");
}

// "(por identificar)" es el del intake social (types.ts), "(sin apellido)" el
// default de incomingLeadSchema y "(@usuario)" el que pone profile.ts cuando el
// nombre de Instagram trae una sola palabra.
export function isPlaceholderLastName(value: string | null | undefined): boolean {
  const v = value?.trim() ?? "";
  return !v || v === PLACEHOLDER_LASTNAME || v === "(sin apellido)" || /^\(@[^)]*\)$/.test(v);
}

/**
 * Qué escribir en la ficha: solo los campos que el formulario trae Y que en
 * el contacto están vacíos o con placeholder. Objeto vacío = nada que hacer.
 */
export function leadFormContactUpdates(
  contact: { firstName: string; lastName: string; phone?: string | null; email?: string | null },
  fields: LeadFormFields
): LeadFormFields {
  const data: LeadFormFields = {};
  if (fields.firstName && isPlaceholderFirstName(contact.firstName)) data.firstName = fields.firstName;
  if (fields.lastName && isPlaceholderLastName(contact.lastName)) data.lastName = fields.lastName;
  if (fields.phone && !contact.phone?.trim()) data.phone = fields.phone;
  if (fields.email && !contact.email?.trim()) data.email = fields.email;
  return data;
}
