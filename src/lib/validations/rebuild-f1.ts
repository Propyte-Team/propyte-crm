// Validaciones zod del rebuild F1 — DSL de condiciones (§D.4), specs de acción,
// credenciales de conectores (Anexo B §H), perfiles/plantillas (§J), intake (§H.5).
import { z } from "zod";
import { normalizePhoneE164 } from "@/lib/phone";

// ---------------------------------------------------------------------------
// DSL de condiciones (Anexo Técnico §D.4)
// ---------------------------------------------------------------------------
export const conditionDslOps = [
  "eq", "neq", "gt", "gte", "lt", "lte",
  "in", "nin", "contains", "exists", "changed_to",
] as const;

const conditionLeafSchema = z.object({
  field: z.string().min(1),
  op: z.enum(conditionDslOps),
  value: z.unknown().optional(),
});

export type ConditionNode =
  | z.infer<typeof conditionLeafSchema>
  | { all: ConditionNode[] }
  | { any: ConditionNode[] };

export const conditionsDslSchema: z.ZodType<ConditionNode | Record<string, never>> = z.lazy(() =>
  z.union([
    z.object({ all: z.array(conditionsDslSchema).min(1) }).strict(),
    z.object({ any: z.array(conditionsDslSchema).min(1) }).strict(),
    conditionLeafSchema.strict(),
    z.object({}).strict(), // sin condiciones = siempre true
  ])
) as never;

// ---------------------------------------------------------------------------
// Spec de acción (AutomationRule.actions[] / ActionPlanStep)
// ---------------------------------------------------------------------------
export const workflowActionTypes = [
  "CREATE_TASK", "SEND_WHATSAPP", "SEND_EMAIL", "MAKE_CALL", "ASSIGN", "REASSIGN",
  "NOTIFY", "UPDATE_FIELD", "ADD_TAG", "CHANGE_STAGE", "ENROLL_PLAN", "ESCALATE",
  "AI_DRAFT", "AI_REPLY", "AI_CALL_SUMMARY", "WEBHOOK",
] as const;

export const actionSpecSchema = z.object({
  type: z.enum(workflowActionTypes),
  config: z.record(z.unknown()).default({}),
  delayMinutes: z.number().int().min(0).optional(),
  autonomyLevel: z.enum(["L0", "L1", "L2"]).optional(),
});

// ---------------------------------------------------------------------------
// Credenciales de conectores (se guardan CIFRADAS con lib/crypto)
// ---------------------------------------------------------------------------
export const connectorCredentialsMetaSchema = z.object({
  pageId: z.string().min(1),
  pageAccessToken: z.string().min(1),
  appSecret: z.string().min(1),
  verifyToken: z.string().min(1),
});

export const connectorCredentialsTikTokSchema = z.object({
  advertiserId: z.string().min(1),
  accessToken: z.string().min(1),
  appId: z.string().optional(),
  secret: z.string().optional(),
});

export const connectorCredentialsWebsiteSchema = z.object({
  webhookSecret: z.string().min(16, "Mínimo 16 caracteres"),
});

export const connectorCredentialsGoogleAdsSchema = z.object({
  customerId: z.string().min(1),       // ID de cliente Google Ads (sin guiones o con ellos)
  developerToken: z.string().min(1),
  refreshToken: z.string().min(1),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  webhookKey: z.string().min(8),        // "key" compartida del Lead Form webhook
  loginCustomerId: z.string().optional(), // MCC, si aplica
});

export const connectorCredentialsLinkedInSchema = z.object({
  adAccountId: z.string().min(1),
  accessToken: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Perfiles de usuario (Anexo B §J.1) — todos los campos opcionales (PATCH parcial)
// ---------------------------------------------------------------------------
export const userProfileSchema = z.object({
  jobTitle: z.string().max(120).optional(),
  bioEs: z.string().max(2000).optional(),
  bioEn: z.string().max(2000).optional(),
  photoUrl: z.string().url().optional(),
  phoneDirect: z.string().optional(),
  whatsappNumber: z.string().optional(),
  languages: z.array(z.enum(["ES", "EN"])).optional(),
  emailFromAlias: z
    .string()
    .email()
    .refine((v) => v.endsWith("@propyte.com"), "El alias debe ser del dominio propyte.com")
    .optional(),
  emailSignatureHtml: z.string().max(20000).optional(),
  cardSlug: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Slug en kebab-case (ej. felipe-luksic)")
    .max(60)
    .optional(),
  cardTheme: z.record(z.unknown()).optional(),
  socialLinks: z.record(z.string().url()).optional(),
  calendarUrl: z.string().url().optional(),
  defaultCadenceId: z.string().uuid().optional().nullable(),
  notificationPrefs: z.record(z.unknown()).optional(),
  workingHours: z.record(z.unknown()).optional(),
});

// ---------------------------------------------------------------------------
// Plantillas (Anexo B §J.2)
// ---------------------------------------------------------------------------
export const userTemplateSchema = z.object({
  channel: z.enum(["WHATSAPP", "EMAIL", "SMS"]),
  name: z.string().min(1).max(120),
  shortcut: z
    .string()
    .regex(/^\/[a-z0-9-]+$/, "Atajo con formato /algo (minúsculas)")
    .max(40)
    .optional(),
  subject: z.string().max(200).optional(),
  body: z.string().min(1).max(10000),
  language: z.enum(["ES", "EN"]),
  isActive: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Intake de leads — contrato del webhook web v2 (Anexo B §H.5) y conectores
// ---------------------------------------------------------------------------
const normalizedPhone = z
  .string()
  .transform((v) => normalizePhoneE164(v))
  .refine((v): v is string => v !== null, "Teléfono inválido (se requiere E.164 o 10 dígitos MX)");

export const incomingLeadSchema = z
  .object({
    source: z.enum([
      "WALK_IN", "FACEBOOK_ADS", "GOOGLE_ADS", "INSTAGRAM", "TIKTOK_ADS", "LINKEDIN",
      "PORTAL_INMOBILIARIO", "REFERIDO_CLIENTE", "REFERIDO_BROKER", "LLAMADA_FRIA",
      "EVENTO", "WEBSITE", "WHATSAPP", "MESSENGER", "OTRO",
    ]),
    firstName: z.string().min(1).max(80).trim(),
    lastName: z.string().min(1).max(80).trim().default("(sin apellido)"),
    phone: normalizedPhone.optional(),
    email: z.string().email().toLowerCase().trim().optional(),
    language: z.enum(["ES", "EN"]).optional(),
    hubDevelopmentId: z.string().optional(),
    message: z.string().max(4000).optional(),
    sourceDetail: z.string().max(200).optional(),
    utm: z
      .object({
        source: z.string().optional(),
        medium: z.string().optional(),
        campaign: z.string().optional(),
        term: z.string().optional(),
        content: z.string().optional(),
      })
      .optional(),
    gclid: z.string().optional(),
    fbclid: z.string().optional(),
    ttclid: z.string().optional(),
    liFatId: z.string().optional(),
    portalLeadId: z.string().optional(),
    landingPage: z.string().optional(),
    referrer: z.string().optional(),
    instagramId: z.string().min(1).max(120).optional(),
    messengerPsid: z.string().min(1).max(120).optional(),
  })
  .refine((d) => !!d.phone || !!d.email || !!d.instagramId || !!d.messengerPsid, {
    message: "Se requiere teléfono, email o identificador social",
    path: ["phone"],
  });

export type IncomingLead = z.infer<typeof incomingLeadSchema>;
export type ActionSpec = z.infer<typeof actionSpecSchema>;
