import { z } from "zod";

// Campos Contact permitidos como destino (+ custom.*). Deben existir en incomingLeadSchema/captureLead.
export const TARGET_FIELDS = [
  "firstName", "lastName", "fullName", "phone", "email", "source", "sourceDetail", "language",
  "contactType", "temperature", "investmentProfile", "propertyType", "purchaseTimeline",
  "paymentMethod", "purchaseModality", "rentalStrategy", "budgetMin", "budgetMax", "preferredZone", "notes",
] as const;

export const METADATA_KEYS = [
  "campaign_name", "campaign_id", "adset_name", "adset_id", "ad_name", "ad_id", "form_id", "leadgen_id",
] as const;

// Opciones de enum por destino (para el value-map en la UI).
export const ENUM_OPTIONS: Record<string, string[]> = {
  contactType: ["COMPRADOR","INVERSIONISTA","BROKER_EXTERNO","EMPLEO","REFERIDOR"],
  temperature: ["HOT","WARM","COLD","DEAD"],
  source: ["WALK_IN","FACEBOOK_ADS","GOOGLE_ADS","INSTAGRAM","TIKTOK_ADS","LINKEDIN","PORTAL_INMOBILIARIO","REFERIDO_CLIENTE","REFERIDO_BROKER","LLAMADA_FRIA","EVENTO","WEBSITE","WHATSAPP","MESSENGER","OTRO"],
  investmentProfile: ["END_USER","INVESTOR_RENTAL","INVESTOR_FLIP","INVESTOR_LAND","MIXED"],
  propertyType: ["DEPARTAMENTO","CASA","TERRENO","MACROLOTE","LOCAL_COMERCIAL","OTRO"],
  purchaseTimeline: ["IMMEDIATE","ONE_TO_THREE_MONTHS","THREE_TO_SIX_MONTHS","SIX_PLUS_MONTHS"],
  paymentMethod: ["CONTADO","CREDITO_HIPOTECARIO","FINANCIAMIENTO_DIRECTO","MIXTO"],
  purchaseModality: ["PREVENTA","ENTREGA_INMEDIATA","REVENTA","ABIERTO"],
  rentalStrategy: ["LONG_TERM","AIRBNB","BOTH","NA"],
};

const targetSchema = z.string().refine(
  (t) => (TARGET_FIELDS as readonly string[]).includes(t) || /^custom\.[A-Za-z0-9_]+$/.test(t),
  { message: "target inválido" }
);

export const mappingRuleSchema = z.object({
  source: z.enum(["question", "metadata", "constant"]),
  metaField: z.string().optional(),
  target: targetSchema,
  value: z.string().optional(),
  valueMap: z.record(z.string()).optional(),
  fallback: z.enum(["omit", "passthrough", "fixed"]).optional(),
  fallbackValue: z.string().optional(),
});

// Union: legacy Record<string,string> | rich {rules}
export const fieldMapSchema = z.union([
  z.object({ rules: z.array(mappingRuleSchema) }).strict(),
  z.record(z.string()),
]);
