import { z } from "zod";
import { LEAD_SOURCE_ORDER } from "@/lib/constants";

// ⚠️ NOTA DE ESTADO (#730, 2026-09-09): a día de hoy NINGÚN archivo importa este
// módulo. `grep -r "validations/contact" src` devuelve solo este archivo. Los esquemas
// que sí se usan viven en `src/server/contacts.ts` y en `src/app/api/contacts/route.ts`,
// y los dos ya validan `leadSource` contra LEAD_SOURCE_ORDER.
//
// Se arregla igual, y no se borra, por dos razones. Un esquema que MIENTE es peor que
// uno que no existe: el siguiente que lo importe se lleva un rechazo de MESSENGER —que
// es justo el canal por el que están entrando los prospectos— sin entender por qué. Y
// borrar archivos no es decisión de una sesión (CLAUDE.md). Si Luis prefiere quitarlo,
// es un `git rm` y esta nota sobra.

// Teléfono: se normaliza (sin espacios/guiones/paréntesis) antes de validar,
// y se persiste normalizado — clave para dedup por teléfono
const phoneSchema = z
  .string()
  .transform((v) => v.replace(/[\s\-().]/g, ""))
  .pipe(
    z
      .string()
      .regex(/^\+?\d{10,15}$/, "Teléfono inválido: usa 10 a 15 dígitos (ej. +52 984 123 4567)")
  );

// --- Esquema base para campos de contacto (alineado con modelo Prisma) ---
const contactBaseSchema = z.object({
  // Nombre del contacto
  firstName: z
    .string()
    .min(2, "El nombre debe tener al menos 2 caracteres")
    .max(100, "El nombre no puede exceder 100 caracteres")
    .trim(),

  // Apellido(s)
  lastName: z
    .string()
    .min(2, "El apellido debe tener al menos 2 caracteres")
    .max(100, "El apellido no puede exceder 100 caracteres")
    .trim(),

  // Correo electrónico (opcional pero válido si se proporciona)
  email: z
    .string()
    .email("Correo electrónico inválido")
    .toLowerCase()
    .trim()
    .optional()
    .or(z.literal("")),

  // Teléfono principal (formato mexicano o internacional, normalizado)
  phone: phoneSchema,

  // Teléfono secundario (opcional)
  secondaryPhone: phoneSchema.optional().or(z.literal("")),

  // Tipo de contacto (enum ContactType)
  contactType: z.enum([
    "LEAD", "PROSPECTO", "CLIENTE", "INVERSIONISTA", "BROKER_EXTERNO", "REFERIDO",
  ]).optional(),

  // Fuente del lead (enum LeadSource)
  // #730: esta era la última copia a mano del enum LeadSource, con 12 de los 21
  // valores. Faltaban TIKTOK_ADS, MESSENGER, META_ADS, BASE_DE_DATOS, SELF_GEN,
  // REGISTRO_BROKER, WEBINAR, LINKEDIN y LLAMADA_ENTRANTE — entre ellos MESSENGER,
  // que hoy es por donde entran los prospectos (24 contactos, el último de hoy).
  //
  // AUD-20260710-02 ya había centralizado la lista en LEAD_SOURCE_ORDER y la había
  // aplicado en el formulario, el listado, el detalle, server/contacts y api/contacts;
  // este archivo se quedó fuera. La paridad con el enum de Prisma la vigila
  // src/lib/constants.lead-source.test.ts.
  leadSource: z.enum(LEAD_SOURCE_ORDER),

  // Detalle de la fuente
  leadSourceDetail: z.string().max(200).optional(),

  // Idioma preferido (enum PreferredLanguage)
  preferredLanguage: z.enum(["ES", "EN"]).optional(),

  // Ubicación
  residenceCity: z.string().max(100).optional(),
  residenceCountry: z.string().max(100).optional(),
  nationality: z.string().max(100).optional(),

  // Perfil de inversión (enum InvestmentProfile)
  investmentProfile: z.enum([
    "END_USER", "INVESTOR_RENTAL", "INVESTOR_FLIP", "INVESTOR_LAND", "MIXED",
  ]).optional().nullable(),

  // Tipo de propiedad (enum PropertyType)
  propertyType: z.enum([
    "DEPARTAMENTO", "CASA", "TERRENO", "MACROLOTE", "LOCAL_COMERCIAL", "OTRO",
  ]).optional().nullable(),

  // Horizonte de compra (enum PurchaseTimeline)
  purchaseTimeline: z.enum([
    "IMMEDIATE", "ONE_TO_THREE_MONTHS", "THREE_TO_SIX_MONTHS", "SIX_PLUS_MONTHS",
  ]).optional().nullable(),

  // Presupuesto mínimo y máximo
  budgetMin: z.number().positive("El presupuesto debe ser positivo").optional().nullable(),
  budgetMax: z.number().positive("El presupuesto debe ser positivo").optional().nullable(),

  // Forma de pago (enum PaymentMethod)
  paymentMethod: z.enum([
    "CONTADO", "CREDITO_HIPOTECARIO", "FINANCIAMIENTO_DIRECTO", "MIXTO",
  ]).optional().nullable(),

  // Zona de interés
  preferredZone: z.string().max(200).trim().optional(),

  // Modalidad de compra (enum PurchaseModality)
  purchaseModality: z.enum([
    "PREVENTA", "ENTREGA_INMEDIATA", "REVENTA", "ABIERTO",
  ]).optional().nullable(),

  // Estrategia de renta (enum RentalStrategy)
  rentalStrategy: z.enum([
    "LONG_TERM", "AIRBNB", "BOTH", "NA",
  ]).optional().nullable(),

  // Temperatura del lead (enum LeadTemperature)
  temperature: z.enum(["HOT", "WARM", "COLD", "DEAD"]).optional(),

  // ID del asesor asignado
  assignedToId: z.string().uuid().optional().nullable(),

  // Etiquetas (tags)
  tags: z.array(z.string().max(50)).max(20, "Máximo 20 etiquetas").optional(),
});

// --- Esquema para creación de contacto ---
export const createContactSchema = contactBaseSchema;

// --- Esquema para actualización de contacto (todos los campos opcionales) ---
export const updateContactSchema = contactBaseSchema.partial().extend({
  id: z.string().uuid("ID de contacto inválido"),
});

// --- Esquema para búsqueda de contactos ---
export const searchContactSchema = z.object({
  query: z.string().max(200).optional(),
  source: z.string().optional(),
  temperature: z.enum(["HOT", "WARM", "COLD", "DEAD"]).optional(),
  type: z.enum(["LEAD", "PROSPECTO", "CLIENTE", "INVERSIONISTA", "BROKER_EXTERNO", "REFERIDO"]).optional(),
  assignedToId: z.string().uuid().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  // NOTA (#745): este `sortBy` sigue siendo texto libre. La lista blanca de columnas
  // ordenables vive en src/lib/api/orden.ts, que llega con el PR #51; atarlo aquí ahora
  // haría que esta rama no compile sin ese PR. Cuando el #51 esté mezclado, esto pasa a
  // `z.enum(ORDEN_POR_ENTIDAD.contact.columnas)`. Mientras tanto no es explotable: este
  // esquema no lo importa nadie (ver la nota de cabecera).
  sortBy: z.string().default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

// --- Tipos inferidos ---
export type CreateContactInput = z.infer<typeof createContactSchema>;
export type UpdateContactInput = z.infer<typeof updateContactSchema>;
export type SearchContactInput = z.infer<typeof searchContactSchema>;
