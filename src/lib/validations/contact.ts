import { z } from "zod";

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

  // Teléfono principal (formato mexicano o internacional)
  phone: z
    .string()
    .min(10, "El teléfono debe tener al menos 10 dígitos")
    .max(15, "El teléfono no puede exceder 15 dígitos")
    .trim(),

  // Teléfono secundario (opcional)
  secondaryPhone: z
    .string()
    .max(15)
    .trim()
    .optional()
    .or(z.literal("")),

  // Tipo de contacto (enum ContactType)
  contactType: z.enum([
    "LEAD", "PROSPECTO", "CLIENTE", "INVERSIONISTA", "BROKER_EXTERNO", "REFERIDO",
  ]).optional(),

  // Fuente del lead (enum LeadSource)
  leadSource: z.enum([
    "WALK_IN", "FACEBOOK_ADS", "GOOGLE_ADS", "INSTAGRAM", "PORTAL_INMOBILIARIO",
    "REFERIDO_CLIENTE", "REFERIDO_BROKER", "LLAMADA_FRIA", "EVENTO", "WEBSITE", "WHATSAPP", "OTRO",
  ]),

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
  sortBy: z.string().default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

// --- Tipos inferidos ---
export type CreateContactInput = z.infer<typeof createContactSchema>;
export type UpdateContactInput = z.infer<typeof updateContactSchema>;
export type SearchContactInput = z.infer<typeof searchContactSchema>;
