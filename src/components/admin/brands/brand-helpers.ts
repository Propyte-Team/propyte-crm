// Utilidades PURAS de la pestaña "Marcas del agente" (2026-10-09, spec marcas-agente).
// Viven fuera de los componentes para poder probarlas en node (sugerencia de slug, armado del
// cuerpo del POST/PATCH, validación del formulario, lectura del error del servidor).
// Reglas que fija este módulo y que NO deben moverse sin tocar el API de la Tarea 10:
//   · al CREAR nunca se manda `botEnabled` (la marca nace con el agente apagado; se enciende al
//     editar, después de revisar el conocimiento);
//   · la marca predeterminada solo acepta `name` (el PATCH rechaza cualquier otra clave);
//   · el slug solo se manda al crear (no se edita después: lo usan otras piezas como identificador).
import { BRAND_CHANNELS } from "@/lib/validations/brand";

/** Valor de `SelectItem` para "sin valor" (Radix no admite value ""): se traduce a `null`. */
export const NONE = "none";

export const BRAND_CHANNEL_OPTIONS: ReadonlyArray<{ value: (typeof BRAND_CHANNELS)[number]; label: string }> = [
  { value: "WHATSAPP", label: "WhatsApp" },
  { value: "INSTAGRAM", label: "Instagram" },
  { value: "MESSENGER", label: "Messenger" },
];

/** Máximos que el API valida (src/lib/validations/brand.ts). */
export const BRAND_LIMITS = { persona: 2000, knowledge: 20000, developments: 20 } as const;

export interface BrandConnector {
  id: string;
  name: string;
  provider: string;
  status: string;
}

/** Fila de GET /api/admin/brands. `enabledChannels` es Json en la base, por eso `unknown`. */
export interface BrandRow {
  id: string;
  name: string;
  slug: string;
  isDefault: boolean;
  persona: string | null;
  knowledge: string | null;
  developmentIds: string[];
  defaultPlaza: string | null;
  enabledChannels: unknown;
  tonePreset: string | null;
  playbookId: string | null;
  marketingOwnerUserId: string | null;
  botEnabled: boolean;
  connectors: BrandConnector[];
}

export type BrandFormMode = "create" | "edit" | "edit-default";

export interface BrandFormState {
  name: string;
  slug: string;
  /** true cuando el usuario escribió el slug a mano: deja de seguir al nombre. */
  slugTouched: boolean;
  persona: string;
  knowledge: string;
  developmentIds: string[];
  /** "" = Ninguna (null). */
  defaultPlaza: string;
  /** true = "Usar los globales" (manda null). */
  useGlobalChannels: boolean;
  channels: string[];
  /** "" = usar el global (null). */
  tonePreset: string;
  /** "" = Ninguno (null). */
  playbookId: string;
  /** "" = el global (null). */
  marketingOwnerUserId: string;
  botEnabled: boolean;
}

/**
 * Sugiere el slug a partir del nombre: minúsculas, sin acentos, cualquier tramo que no sea
 * letra/número → "-", sin guiones en los extremos y máximo 40 caracteres (el límite del API).
 */
export function suggestSlug(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9-]{2,40}$/.test(slug);
}

/** Canales guardados (Json) → lista conocida, o null si hereda los globales. */
export function parseChannels(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter(
    (v): v is string => typeof v === "string" && (BRAND_CHANNELS as readonly string[]).includes(v)
  );
}

export function emptyBrandForm(): BrandFormState {
  return {
    name: "",
    slug: "",
    slugTouched: false,
    persona: "",
    knowledge: "",
    developmentIds: [],
    defaultPlaza: "",
    useGlobalChannels: true,
    channels: [],
    tonePreset: "",
    playbookId: "",
    marketingOwnerUserId: "",
    botEnabled: false,
  };
}

export function brandToForm(brand: BrandRow): BrandFormState {
  const channels = parseChannels(brand.enabledChannels);
  return {
    name: brand.name,
    slug: brand.slug,
    slugTouched: true,
    persona: brand.persona ?? "",
    knowledge: brand.knowledge ?? "",
    developmentIds: [...brand.developmentIds],
    defaultPlaza: brand.defaultPlaza ?? "",
    useGlobalChannels: channels === null,
    channels: channels ?? [],
    tonePreset: brand.tonePreset ?? "",
    playbookId: brand.playbookId ?? "",
    marketingOwnerUserId: brand.marketingOwnerUserId ?? "",
    botEnabled: brand.botEnabled,
  };
}

/** Mensaje para mostrar bajo el formulario, o null si se puede enviar. */
export function validateBrandForm(form: BrandFormState, mode: BrandFormMode): string | null {
  const name = form.name.trim();
  if (name.length < 2 || name.length > 80) return "El nombre debe tener entre 2 y 80 caracteres";
  if (mode === "edit-default") return null;
  if (mode === "create" && !isValidSlug(form.slug)) {
    return "El identificador solo admite minúsculas, números y guiones (2 a 40 caracteres)";
  }
  // `enabledChannels: []` no es "heredar": bot-respond lo lee como "no contestar en ningún canal" y
  // silenciaría al agente de la marca sin aviso. Heredar es `null` ("Usar los globales").
  if (!form.useGlobalChannels && form.channels.length === 0) {
    return "Elige al menos un canal o marca «Usar los globales».";
  }
  if (form.persona.length > BRAND_LIMITS.persona) {
    return `La presentación no puede pasar de ${BRAND_LIMITS.persona} caracteres`;
  }
  if (form.knowledge.length > BRAND_LIMITS.knowledge) {
    return `El conocimiento no puede pasar de ${BRAND_LIMITS.knowledge} caracteres`;
  }
  if (form.developmentIds.length > BRAND_LIMITS.developments) {
    return `Una marca admite como máximo ${BRAND_LIMITS.developments} desarrollos`;
  }
  return null;
}

const orNull = (value: string): string | null => (value === "" || value === NONE ? null : value);
const textOrNull = (value: string): string | null => (value.trim() === "" ? null : value.trim());

/** Cuerpo del POST (create) o PATCH (edit / edit-default). Ver las reglas en el encabezado. */
export function buildBrandPayload(form: BrandFormState, mode: BrandFormMode): Record<string, unknown> {
  const name = form.name.trim();
  if (mode === "edit-default") return { name };

  const payload: Record<string, unknown> = {
    name,
    persona: textOrNull(form.persona),
    knowledge: textOrNull(form.knowledge),
    developmentIds: form.developmentIds,
    defaultPlaza: orNull(form.defaultPlaza),
    enabledChannels: form.useGlobalChannels ? null : form.channels,
    tonePreset: orNull(form.tonePreset),
    playbookId: orNull(form.playbookId),
    marketingOwnerUserId: orNull(form.marketingOwnerUserId),
  };
  if (mode === "create") payload.slug = form.slug;
  else payload.botEnabled = form.botEnabled;
  return payload;
}

/**
 * El API devuelve `{ error: string }` (409, 403, 400 de negocio) o `{ error: { formErrors,
 * fieldErrors } }` (400 de zod). Siempre da texto legible; si no hay nada útil, `fallback`.
 */
export function apiErrorMessage(data: unknown, fallback: string): string {
  const error = (data as { error?: unknown } | null)?.error;
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object") {
    const { formErrors, fieldErrors } = error as {
      formErrors?: unknown;
      fieldErrors?: Record<string, unknown>;
    };
    const parts: string[] = [];
    if (Array.isArray(formErrors)) parts.push(...formErrors.filter((m): m is string => typeof m === "string"));
    for (const [field, msgs] of Object.entries(fieldErrors ?? {})) {
      if (Array.isArray(msgs) && msgs.length > 0) parts.push(`${field}: ${msgs.join(", ")}`);
    }
    if (parts.length > 0) return parts.join("; ");
  }
  return fallback;
}
