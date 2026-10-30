// ============================================================
// Constantes globales del CRM Propyte
// Alineado con enums de Prisma (DealStage, DealType, etc.)
// ============================================================

// --- Colores corporativos ---
export const COLORS = {
  primary: "#1E3A5F",
  primaryLight: "#2D5A8E",
  secondary: "#F5A623",
  secondaryLight: "#F7BC5E",
  success: "#22C55E",
  warning: "#F59E0B",
  danger: "#EF4444",
  info: "#3B82F6",
  neutral: "#6B7280",
  background: "#F9FAFB",
  surface: "#FFFFFF",
  textPrimary: "#111827",
  textSecondary: "#6B7280",
  border: "#E5E7EB",
} as const;

// --- Etapas del pipeline de ventas (alineado con enum DealStage de Prisma) ---
export interface PipelineStage {
  label: string;
  code: string;
  probability: number;
  stagnationDays: number;
  color: string;
}

// Colores = espectro funnel del speckit de diseño §2.1 (frío→cálido→cierre).
// Es el ELEMENTO FIRMA: único lugar protagonista del color (chip/kanban/barra).
export const PIPELINE_STAGES: PipelineStage[] = [
  {
    label: "Nuevo Lead",
    code: "NEW_LEAD",
    probability: 5,
    stagnationDays: 3,
    color: "#94A3B8",
  },
  {
    label: "Contactado",
    code: "CONTACTED",
    probability: 10,
    stagnationDays: 5,
    color: "#64748B",
  },
  {
    label: "Discovery Hecho",
    code: "DISCOVERY_DONE",
    probability: 20,
    stagnationDays: 7,
    color: "#3B82F6",
  },
  {
    label: "Reunión Agendada",
    code: "MEETING_SCHEDULED",
    probability: 35,
    stagnationDays: 5,
    color: "#2563EB",
  },
  {
    label: "Reunión Realizada",
    code: "MEETING_COMPLETED",
    probability: 45,
    stagnationDays: 5,
    color: "#1D4ED8",
  },
  {
    label: "Propuesta Enviada",
    code: "PROPOSAL_SENT",
    probability: 55,
    stagnationDays: 7,
    color: "#6366F1",
  },
  {
    label: "Negociación",
    code: "NEGOTIATION",
    probability: 70,
    stagnationDays: 10,
    color: "#D97706",
  },
  {
    label: "Reservado",
    code: "RESERVED",
    probability: 85,
    stagnationDays: 14,
    color: "#F59E0B",
  },
  {
    label: "Contrato Firmado",
    code: "CONTRACT_SIGNED",
    probability: 90,
    stagnationDays: 21,
    color: "#0D9488",
  },
  {
    label: "Cierre",
    code: "CLOSING",
    probability: 95,
    stagnationDays: 30,
    color: "#0F766E",
  },
  {
    label: "Ganado",
    code: "WON",
    probability: 100,
    stagnationDays: 0,
    color: "#16A34A",
  },
  {
    label: "Perdido",
    code: "LOST",
    probability: 0,
    stagnationDays: 0,
    color: "#DC2626",
  },
  {
    label: "Congelado",
    code: "FROZEN",
    probability: 0,
    stagnationDays: 0,
    color: "#9CA3AF",
  },
];

// Mapa rápido de probabilidad por etapa
export const DEAL_STAGE_PROBABILITY: Record<string, number> = Object.fromEntries(
  PIPELINE_STAGES.map((s) => [s.code, s.probability])
);

// Mapa rápido de límite de estancamiento por etapa (en días)
export const STAGNATION_LIMITS: Record<string, number> = Object.fromEntries(
  PIPELINE_STAGES.map((s) => [s.code, s.stagnationDays])
);

// Mapa de colores por etapa
export const STAGE_COLORS: Record<string, string> = Object.fromEntries(
  PIPELINE_STAGES.map((s) => [s.code, s.color])
);

// Etiquetas de etapas en español
export const STAGE_LABELS: Record<string, string> = Object.fromEntries(
  PIPELINE_STAGES.map((s) => [s.code, s.label])
);

// Etapas activas (visibles en kanban, excluyendo WON, LOST, FROZEN)
export const ACTIVE_PIPELINE_STAGES = PIPELINE_STAGES.filter(
  (s) => !["WON", "LOST", "FROZEN"].includes(s.code)
);

// --- Roles del sistema (alineado con enum UserRole de Prisma) ---
export const ROLE_LABELS: Record<string, string> = {
  DIRECTOR: "Director",
  GERENTE: "Gerente de plaza",
  TEAM_LEADER: "Líder de equipo",
  ASESOR_SR: "Asesor Senior",
  ASESOR_JR: "Asesor Junior",
  HOSTESS: "Hostess",
  MARKETING: "Marketing",
  DEVELOPER_EXT: "Desarrollador Externo",
} as const;

// --- Tipos de operación (alineado con enum DealType de Prisma) ---
export const DEAL_TYPE_LABELS: Record<string, string> = {
  NATIVA_CONTADO: "Nativa Contado",
  NATIVA_FINANCIAMIENTO: "Nativa Financiamiento",
  MACROLOTE: "Macrolote",
  CORRETAJE: "Corretaje",
  MASTERBROKER: "MasterBroker",
} as const;

// --- Razones de pérdida ---
export const LOST_REASON_LABELS: Record<string, string> = {
  PRECIO: "Precio",
  COMPETENCIA: "Competencia",
  FINANCIAMIENTO_RECHAZADO: "Financiamiento Rechazado",
  NO_INTERESADO: "No Interesado",
  NO_CONTACTABLE: "No Contactable",
  COMPRO_DIRECTO: "Compró Directo",
  DESARROLLO_CANCELADO: "Desarrollo Cancelado",
  OTRO: "Otro",
} as const;

// --- Fuentes de leads (alineado con enum LeadSource de Prisma) ---
// Única fuente de verdad (patrón CONTACT_STATUS_ORDER): alimenta los selects de
// alta/filtro/detalle y los z.enum de las APIs. AUD-20260710-02: había 3 mapas
// desincronizados con 12/21 fuentes — un valor válido en BD quedaba inelegible/sin label.
// Paridad con el enum Prisma fijada por constants.lead-source.test.ts.
export const LEAD_SOURCE_ORDER = [
  // Pagado / social
  "FACEBOOK_ADS",
  "INSTAGRAM",
  "META_ADS",
  "MESSENGER",
  "GOOGLE_ADS",
  "TIKTOK_ADS",
  "LINKEDIN",
  // Directo / orgánico
  "WHATSAPP",
  "WEBSITE",
  "PORTAL_INMOBILIARIO",
  "WALK_IN",
  "LLAMADA_ENTRANTE",
  // Eventos y actividad propia
  "WEBINAR",
  "EVENTO",
  "LLAMADA_FRIA",
  "SELF_GEN",
  "BASE_DE_DATOS",
  // Referidos / brokers. #929: «Referido de Broker» (REFERIDO_BROKER) se retiró: lo que trae
  // un broker es «Registro de Broker». Ver LEAD_SOURCE_RETIRADAS.
  "REFERIDO_CLIENTE",
  "REGISTRO_BROKER",
  "OTRO",
] as const;

/**
 * Fuentes que siguen en el enum LeadSource de la base pero ya no se ofrecen ni se aceptan
 * desde la UI (#929), con la vigente que las reemplaza. Mismo patrón que CONTACT_TYPE_RETIRADOS.
 */
export const LEAD_SOURCE_RETIRADAS = {
  REFERIDO_BROKER: "REGISTRO_BROKER",
} as const;

/** Traduce una fuente retirada a la vigente (para entradas externas: Zapier, conectores). */
export function normalizarFuente(valor: unknown): unknown {
  if (typeof valor === "string" && Object.prototype.hasOwnProperty.call(LEAD_SOURCE_RETIRADAS, valor)) {
    return LEAD_SOURCE_RETIRADAS[valor as keyof typeof LEAD_SOURCE_RETIRADAS];
  }
  return valor;
}

/** La fuente de todo contacto ligado a un broker (#929): elegir broker la pone sola. */
export const LEAD_SOURCE_BROKER = "REGISTRO_BROKER" as const;

export const LEAD_SOURCE_LABELS: Record<string, string> = {
  FACEBOOK_ADS: "Facebook Ads",
  INSTAGRAM: "Instagram",
  META_ADS: "Meta Ads",
  MESSENGER: "Messenger",
  GOOGLE_ADS: "Google Ads",
  TIKTOK_ADS: "TikTok Ads",
  LINKEDIN: "LinkedIn",
  WHATSAPP: "WhatsApp",
  WEBSITE: "Sitio web",
  PORTAL_INMOBILIARIO: "Portal Inmobiliario",
  WALK_IN: "Walk-in",
  LLAMADA_ENTRANTE: "Llamada entrante",
  WEBINAR: "Webinar",
  EVENTO: "Evento",
  LLAMADA_FRIA: "Llamada en frío",
  SELF_GEN: "Prospección propia",
  BASE_DE_DATOS: "Base de datos",
  REFERIDO_CLIENTE: "Referido de Cliente",
  // Retirada (#929): solo para mostrar el historial.
  REFERIDO_BROKER: "Referido de Broker",
  REGISTRO_BROKER: "Registro de Broker",
  OTRO: "Otro",
} as const;

// --- Tipos de actividad (alineado con enum ActivityType de Prisma) ---
export const ACTIVITY_TYPE_LABELS: Record<string, string> = {
  CALL_OUTBOUND: "Llamada saliente",
  CALL_INBOUND: "Llamada entrante",
  WHATSAPP_OUT: "WhatsApp enviado",
  WHATSAPP_IN: "WhatsApp recibido",
  SMS_OUT: "SMS enviado",
  SMS_IN: "SMS recibido",
  EMAIL_SENT: "Email enviado",
  EMAIL_RECEIVED: "Email recibido",
  MEETING_VIRTUAL: "Reunión virtual",
  MEETING_PRESENTIAL: "Reunión presencial",
  MEETING_SHOWROOM: "Reunión en showroom",
  DISCOVERY_CALL: "Discovery call",
  PROPOSAL_DELIVERY: "Entrega de propuesta",
  FOLLOW_UP: "Seguimiento",
  WALK_IN: "Walk-in",
  NOTE: "Nota",
  TASK: "Tarea",
  CALL_TASK: "Llamada pendiente",
  CONTRACT_REVIEW: "Revisión de contrato",
  CLOSING_ACTIVITY: "Actividad de cierre",
} as const;

// --- Temperaturas del lead ---
export const LEAD_TEMPERATURE_LABELS: Record<string, string> = {
  HOT: "Caliente",
  WARM: "Tibio",
  COLD: "Frío",
  DEAD: "Muerto",
} as const;

// --- Colores de temperatura ---
export const TEMPERATURE_COLORS: Record<string, string> = {
  HOT: "bg-red-500",
  WARM: "bg-orange-500",
  COLD: "bg-blue-500",
  DEAD: "bg-gray-400",
} as const;

// --- Estado del contacto (ciclo de seguimiento, distinto del pipeline del deal) ---
// Orden = escalera del ciclo de contacto; los legacy (EN_SEGUIMIENTO/DESCARTADO) quedan
// al final — siguen soportados pero ya no son parte del flujo activo recomendado.
export const CONTACT_STATUS_LABELS: Record<string, string> = {
  NUEVO: "Nuevo",
  SIN_RESPUESTA: "Sin respuesta",
  CONTACTADO: "Contactado",
  CONTACTADO_PERDIDO: "Contactado perdido",
  REUNION: "Reunión",
  PROSPECTO: "Prospecto",
  PERDIDO: "Perdido",
  EN_SEGUIMIENTO: "En seguimiento",
  DESCARTADO: "Descartado",
} as const;

// Color = señal (dot/chip). Espectro frío→activo→inerte, coherente con el funnel.
export const CONTACT_STATUS_COLORS: Record<string, string> = {
  NUEVO: "#3B82F6",
  SIN_RESPUESTA: "#F59E0B",
  CONTACTADO: "#6366F1",
  CONTACTADO_PERDIDO: "#DC2626",
  REUNION: "#8B5CF6",
  PROSPECTO: "#0EA5E9",
  PERDIDO: "#EF4444",
  EN_SEGUIMIENTO: "#0D9488",
  DESCARTADO: "#9CA3AF",
} as const;

export const CONTACT_STATUS_ORDER = [
  "NUEVO",
  "SIN_RESPUESTA",
  "CONTACTADO",
  "CONTACTADO_PERDIDO",
  "REUNION",
  "PROSPECTO",
  "PERDIDO",
  "EN_SEGUIMIENTO",
  "DESCARTADO",
] as const;

// --- Lifecycle del contacto (embudo del comprador/inversionista, tipo HubSpot) ---
export const LIFECYCLE_ORDER = [
  "SUSCRIPTOR","LEAD","MQL","SQL","OPORTUNIDAD","CLIENTE","EMBAJADOR",
] as const;

export const LIFECYCLE_LABELS: Record<string, string> = {
  SUSCRIPTOR: "Suscriptor",
  LEAD: "Lead",
  MQL: "MQL",
  SQL: "Prospecto (SQL)",
  OPORTUNIDAD: "Oportunidad",
  CLIENTE: "Cliente",
  EMBAJADOR: "Embajador",
};

// Espectro funnel frío→cierre (coherente con el rediseño B/N: color solo en etiqueta de etapa).
export const LIFECYCLE_COLORS: Record<string, string> = {
  SUSCRIPTOR: "#94A3B8",
  LEAD: "#3B82F6",
  MQL: "#6366F1",
  SQL: "#8B5CF6",
  OPORTUNIDAD: "#D97706",
  CLIENTE: "#0D9488",
  EMBAJADOR: "#059669",
};

// --- Urgencia del contacto ---
export const URGENCY_LABELS: Record<string, string> = {
  ALTA: "Alta",
  MEDIA: "Media",
  BAJA: "Baja",
} as const;

export const URGENCY_COLORS: Record<string, string> = {
  ALTA: "#DC2626",
  MEDIA: "#D97706",
  BAJA: "#64748B",
} as const;

// --- Tipo de contacto ---
// Única fuente de verdad de los tipos de contacto, en el orden en que se ofrecen.
// Mismo patrón que LEAD_SOURCE_ORDER y CONTACT_STATUS_ORDER, y por la misma razón (#730):
// los z.enum escritos a mano se desincronizan del enum ContactType de Prisma sin que nada
// avise. Faltaba sobre todo COMPRADOR, que es el DEFAULT del modelo (schema.prisma) y el
// valor que escribe el intake, así que el valor por defecto del sistema no era elegible.
// La paridad con el enum la vigila src/lib/constants.contact-type.test.ts.
//
// #907 (2026-10-19, pedido de sistemas@): «Broker externo» se muestra como «Broker» (el valor
// interno BROKER_EXTERNO no cambia: lo usan los perfiles del bot, las reglas y el clasificador),
// «Referidor» deja de ofrecerse —el que refiere ES el broker— y entran PROVEEDOR y OTRO.
// #929 (2026-10-26): «Referido» también sale. Que a alguien lo trajo un broker lo dicen la liga
// «Registrado por» y la fuente «Registro de Broker»; su tipo es lo que la conversación diga
// (Comprador, Inversionista, Cliente, Otro…).
// #938 (2026-10-29, pedido de sistemas@): Lead, Comprador e Inversionista se juntan en
// «Lead Comprador»; entran «Lead Vendedor» (quien quiere vender su propiedad) y vuelven los
// referidos, ahora como dos tipos: «Referido de Broker» y «Referido de Cliente». Revierte a
// propósito la parte de tipos del #929; «Registrado por» sigue diciendo QUÉ broker lo trajo.
export const CONTACT_TYPE_ORDER = [
  "LEAD_COMPRADOR",
  "LEAD_VENDEDOR",
  "PROSPECTO",
  "CLIENTE",
  "REFERIDO_DE_BROKER",
  "REFERIDO_DE_CLIENTE",
  "BROKER_EXTERNO",
  "EMPLEO",
  "PROVEEDOR",
  "OTRO",
] as const;

/**
 * Tipos que siguen existiendo en el enum ContactType de la base pero YA NO se ofrecen ni se
 * aceptan como entrada, con el tipo vigente que los reemplaza (null = queda sin tipo). Se
 * quedan en el enum porque Postgres no deja quitar un valor sin recrear el tipo, y porque la
 * cronología guarda cambios viejos con ese valor.
 *  - REFERIDOR (#907): el que refiere es el broker.
 *  - REFERIDO (#929): no hay un tipo que lo sustituya; su tipo sale de la conversación. Con el
 *    #938 hay dos referidos, pero el valor viejo no dice si era de broker o de cliente, así que
 *    sigue quedando sin tipo.
 *  - LEAD, COMPRADOR e INVERSIONISTA (#938): se juntan en LEAD_COMPRADOR.
 */
export const CONTACT_TYPE_RETIRADOS: Record<string, string | null> = {
  REFERIDOR: "BROKER_EXTERNO",
  REFERIDO: null,
  LEAD: "LEAD_COMPRADOR",
  COMPRADOR: "LEAD_COMPRADOR",
  INVERSIONISTA: "LEAD_COMPRADOR",
};

/**
 * Traduce un tipo retirado a su reemplazo y deja pasar todo lo demás tal cual. Para las
 * entradas EXTERNAS (Zapier, conectores de leads), donde una integración configurada antes
 * puede seguir mandando un tipo retirado: se acepta en vez de rechazar el lead. Un retirado
 * sin reemplazo (REFERIDO) sale como `undefined` = «no viene tipo» (al crear, nace sin tipo;
 * al editar, no se toca). Las entradas de la propia UI validan contra CONTACT_TYPE_ORDER a secas.
 */
export function normalizarTipoContacto(valor: unknown): unknown {
  if (typeof valor === "string" && Object.prototype.hasOwnProperty.call(CONTACT_TYPE_RETIRADOS, valor)) {
    return CONTACT_TYPE_RETIRADOS[valor] ?? undefined;
  }
  return valor;
}

/**
 * Un tipo y los retirados que se traducen a él (#938): LEAD_COMPRADOR → [LEAD_COMPRADOR, LEAD,
 * COMPRADOR, INVERSIONISTA]. Un tipo retirado se traduce primero. Para BUSCAR por tipo (filtro de
 * la lista, perfil del agente del bot) sin perder lo que todavía guarda el valor viejo: los datos
 * se migran después del despliegue, y un perfil o un contacto puede quedar con el valor viejo.
 * Un retirado sin reemplazo (REFERIDO) o un valor desconocido se devuelven tal cual.
 */
export function tiposEquivalentes(tipo: string): string[] {
  const vigente = normalizarTipoContacto(tipo);
  if (typeof vigente !== "string") return [tipo];
  const retirados = Object.keys(CONTACT_TYPE_RETIRADOS).filter((k) => CONTACT_TYPE_RETIRADOS[k] === vigente);
  return [vigente, ...retirados];
}

/** El tipo que define a un broker (#907): solo estos contactos pueden tener referidos. */
export const CONTACT_TYPE_BROKER = "BROKER_EXTERNO" as const;

/**
 * Valor del filtro «Sin tipo» (#863): contactos con contactType NULL. No es un valor del
 * enum ContactType — solo viaja como `?type=` y se traduce a `contactType: null`.
 */
export const CONTACT_TYPE_SIN_TIPO = "SIN_TIPO";

/** Etiqueta de un contacto sin tipo, en tablas y selectores. */
export const CONTACT_TYPE_VACIO_LABEL = "—";

/**
 * ¿El contacto lleva ciclo de vida (Lead → MQL → SQL…)? Los leads y referidos (#938) y, desde
 * el #863, los que aún no tienen tipo: antes todos nacían COMPRADOR y entraban aquí, así que
 * excluir a los «sin tipo» habría dejado de avanzar la etapa de cada prospecto nuevo.
 * Única fuente de la regla: la usan el auto-avance (lifecycle/apply.ts) y la ficha.
 *
 * #938: antes eran Comprador e Inversionista. Un tipo retirado se evalúa como su reemplazo,
 * así un contacto que todavía no pasa por la migración de datos no pierde su ciclo de vida.
 */
const TIPOS_CON_CICLO_DE_VIDA: ReadonlySet<string> = new Set([
  "LEAD_COMPRADOR",
  "LEAD_VENDEDOR",
  "REFERIDO_DE_BROKER",
  "REFERIDO_DE_CLIENTE",
]);

export function tieneCicloDeVida(contactType: string | null | undefined): boolean {
  if (contactType == null) return true;
  const vigente = normalizarTipoContacto(contactType);
  return typeof vigente === "string" && TIPOS_CON_CICLO_DE_VIDA.has(vigente);
}

export const CONTACT_TYPE_LABELS: Record<string, string> = {
  LEAD_COMPRADOR: "Lead Comprador",
  LEAD_VENDEDOR: "Lead Vendedor",
  PROSPECTO: "Prospecto",
  CLIENTE: "Cliente",
  REFERIDO_DE_BROKER: "Referido de Broker",
  REFERIDO_DE_CLIENTE: "Referido de Cliente",
  BROKER_EXTERNO: "Broker",
  EMPLEO: "Empleo",
  PROVEEDOR: "Proveedor",
  OTRO: "Otro",
  // Retirados (#907, #929, #938): solo para mostrar cambios viejos de la cronología.
  REFERIDOR: "Referidor",
  REFERIDO: "Referido",
  LEAD: "Lead",
  COMPRADOR: "Comprador",
  INVERSIONISTA: "Inversionista",
} as const;

// --- Estados de desarrollo ---
export const DEVELOPMENT_STATUS_LABELS: Record<string, string> = {
  PREVENTA: "Preventa",
  CONSTRUCCION: "Construcción",
  ENTREGA_INMEDIATA: "Entrega Inmediata",
  VENDIDO: "Vendido",
  SUSPENDIDO: "Suspendido",
} as const;

export const DEVELOPMENT_STATUS_COLORS: Record<string, string> = {
  PREVENTA: "bg-blue-100 text-blue-700",
  CONSTRUCCION: "bg-yellow-100 text-yellow-700",
  ENTREGA_INMEDIATA: "bg-green-100 text-green-700",
  VENDIDO: "bg-gray-100 text-gray-700",
  SUSPENDIDO: "bg-red-100 text-red-700",
} as const;

// --- Tipos de desarrollo ---
export const DEVELOPMENT_TYPE_LABELS: Record<string, string> = {
  PROPIO: "Propio",
  MASTERBROKER: "MasterBroker",
  CORRETAJE: "Corretaje",
} as const;

// --- Estados de unidad ---
export const UNIT_STATUS_LABELS: Record<string, string> = {
  DISPONIBLE: "Disponible",
  APARTADA: "Apartada",
  VENDIDA: "Vendida",
  NO_DISPONIBLE: "No Disponible",
} as const;

export const UNIT_STATUS_COLORS: Record<
  string,
  { bg: string; text: string; border: string }
> = {
  DISPONIBLE: { bg: "bg-green-100", text: "text-green-700", border: "border-green-300" },
  APARTADA: { bg: "bg-yellow-100", text: "text-yellow-700", border: "border-yellow-300" },
  VENDIDA: { bg: "bg-red-100", text: "text-red-700", border: "border-red-300" },
  NO_DISPONIBLE: { bg: "bg-gray-100", text: "text-gray-500", border: "border-gray-300" },
};

// --- Tipos de unidad ---
export const UNIT_TYPE_LABELS: Record<string, string> = {
  DEPTO_1REC: "Depto 1 Rec",
  DEPTO_2REC: "Depto 2 Rec",
  DEPTO_3REC: "Depto 3 Rec",
  PENTHOUSE: "Penthouse",
  CASA: "Casa",
  TERRENO: "Terreno",
  MACROLOTE: "Macrolote",
  LOCAL: "Local",
} as const;

// --- Plazas ---
export const PLAZA_LABELS: Record<string, string> = {
  PDC: "Playa del Carmen",
  TULUM: "Tulum",
  MERIDA: "Mérida",
} as const;

// --- Categorías de fuente de lead (para comisiones) ---
export const LEAD_SOURCE_CATEGORY_LABELS: Record<string, string> = {
  PROPYTE_LEAD: "Lead Propyte",
  BROKER_LEAD: "Lead Broker",
  ASESOR_LEAD: "Lead Asesor",
} as const;

// --- Monedas ---
export const CURRENCY_LABELS: Record<string, string> = {
  MXN: "MXN",
  USD: "USD",
} as const;

// --- Valores por defecto para acuerdos de actividad ---
export const ACTIVITY_AGREEMENT_DEFAULTS = {
  minDailyCalls: 20,
  minDailyWhatsapps: 30,
  minWeeklyVisits: 5,
  minDailyFollowUps: 10,
  maxFirstResponseMinutes: 5,
  maxInactivityDays: 2,
} as const;

// --- Requisitos de carrera / plan de carrera ---
export const CAREER_REQUIREMENTS = {
  JR: {
    label: "Asesor Junior",
    minDeals: 0,
    minMonths: 0,
    requirements: ["Capacitación inicial completada"],
  },
  SR: {
    label: "Asesor Senior",
    minDeals: 5,
    minMonths: 3,
    requirements: [
      "3 meses como Junior",
      "5 cierres acumulados",
      "Cumplir meta de actividad 2 meses consecutivos",
    ],
  },
  TOP_PRODUCER: {
    label: "Top Producer",
    minDeals: 15,
    minMonths: 6,
    requirements: [
      "15 cierres acumulados",
      "6 meses como Senior",
      "Tasa de conversión >= 15%",
    ],
  },
  TEAM_LEADER: {
    label: "Líder de equipo",
    minDeals: 30,
    minMonths: 12,
    requirements: [
      "30 cierres acumulados",
      "12 meses en la empresa",
      "Certificación de liderazgo",
    ],
  },
  GERENTE: {
    label: "Gerente de plaza",
    minDeals: 60,
    minMonths: 24,
    requirements: [
      "60 cierres acumulados",
      "24 meses en la empresa",
      "Haber liderado equipo >= 6 meses",
    ],
  },
} as const;

// --- Formateador de moneda ---
export function formatMXN(value: number | string): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(num);
}

export function formatUSD(value: number | string): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(num);
}

export function formatCurrency(value: number | string, currency: string = "MXN"): string {
  return currency === "USD" ? formatUSD(value) : formatMXN(value);
}
