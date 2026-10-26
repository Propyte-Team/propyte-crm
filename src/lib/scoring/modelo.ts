// Modelo de lead scoring (spec 2026-10-26-lead-scoring-design.md).
//
// El modelo es DATO, no código: vive en SystemConfig bajo `scoring.modelo` y se puede cambiar
// a mano (hoy con updateSystemConfig / src/server/scoring.ts; mañana con un editor en admin)
// sin desplegar. Si la clave no existe o no pasa la validación, se usa MODELO_DEFAULT: un
// modelo mal escrito nunca deja al CRM sin score ni tumba el cron.
import { z } from "zod";

export const FAMILIAS = ["perfil", "fuente", "conversacion", "web_citas"] as const;
export type Familia = (typeof FAMILIAS)[number];

const base = {
  id: z.string().min(1),
  familia: z.enum(FAMILIAS),
  etiqueta: z.string().min(1),
};

/** Un campo del contacto con puntos por valor (`purchaseTimeline`, `leadSource`, …). */
const reglaCampo = z.object({
  ...base,
  tipo: z.literal("campo"),
  campo: z.string().min(1),
  valores: z.record(z.string(), z.number()),
});

/** Puntos si TODOS los campos tienen valor (p. ej. teléfono y correo). */
const reglaCamposPresentes = z.object({
  ...base,
  tipo: z.literal("campos_presentes"),
  campos: z.array(z.string().min(1)).min(1),
  puntos: z.number(),
});

/** Presupuesto en MXN (budgetMax, si no budgetMin); USD se convierte con `tipoCambioUSD`. */
const reglaPresupuesto = z.object({
  ...base,
  tipo: z.literal("presupuesto"),
  tipoCambioUSD: z.number().positive(),
  escalones: z.array(z.object({ minMXN: z.number().nonnegative(), puntos: z.number() })).min(1),
});

/** Actividades de ciertos tipos en una ventana: puntos por la primera y por cada adicional. */
const reglaActividad = z.object({
  ...base,
  tipo: z.literal("actividad"),
  tipos: z.array(z.string().min(1)).min(1),
  dentroDeDias: z.number().int().positive(),
  puntosPrimera: z.number(),
  puntosAdicional: z.number().default(0),
  maxPuntos: z.number().optional(),
});

/** Mensajes entrantes (cualquier canal) en una ventana. */
const reglaEntrantes = z.object({
  ...base,
  tipo: z.literal("entrantes"),
  dentroDeDias: z.number().int().positive(),
  puntosPrimera: z.number(),
  puntosAdicional: z.number().default(0),
  maxPuntos: z.number().optional(),
});

/** El bot terminó su playbook de calificación en alguna conversación. */
const reglaPlaybook = z.object({
  ...base,
  tipo: z.literal("playbook_completado"),
  puntos: z.number(),
});

/** Comportamiento web (`WebBehavior`): `campo ≥ min`. */
const reglaWeb = z.object({
  ...base,
  tipo: z.literal("web"),
  campo: z.enum(["daysVisited", "chatCount", "visitorScore"]),
  min: z.number(),
  puntos: z.number(),
});

export const reglaSchema = z.discriminatedUnion("tipo", [
  reglaCampo,
  reglaCamposPresentes,
  reglaPresupuesto,
  reglaActividad,
  reglaEntrantes,
  reglaPlaybook,
  reglaWeb,
]);
export type Regla = z.infer<typeof reglaSchema>;

export const modeloSchema = z
  .object({
    version: z.number().int().positive(),
    reglas: z.array(reglaSchema),
    topesPorFamilia: z.record(z.enum(FAMILIAS), z.number().nonnegative()),
    maximo: z.number().positive().default(100),
    decaimiento: z.object({
      porcentaje: z.number().min(0).max(100),
      cadaDias: z.number().int().positive(),
      familias: z.array(z.enum(FAMILIAS)),
    }),
    /** contactType que NO se califican (score null): no son compradores. */
    tiposExcluidos: z.array(z.string()),
    /** contactStatus que dejan el score en 0. */
    estadosAnulan: z.array(z.string()),
    /** Umbrales con etiqueta; al cruzarlos se emite `contact.scored` (solo con scoring activo). */
    umbrales: z.array(z.object({ etiqueta: z.string().min(1), min: z.number() })),
  })
  .superRefine((m, ctx) => {
    const ids = new Set<string>();
    for (const r of m.reglas) {
      if (ids.has(r.id)) ctx.addIssue({ code: "custom", message: `Regla repetida: ${r.id}` });
      ids.add(r.id);
    }
  });
export type ModeloScore = z.infer<typeof modeloSchema>;

const ENTRANTES = ["WHATSAPP_IN", "INSTAGRAM_IN", "MESSENGER_IN", "SMS_IN", "EMAIL_RECEIVED", "CALL_INBOUND"];
export const TIPOS_ACTIVIDAD_ENTRANTE = ENTRANTES;

/**
 * Modelo por defecto (spec §3). Los pesos son el punto de partida; se calibran con
 * scripts/scoring-backtest.ts y se ajustan guardando un `scoring.modelo` con `version` mayor.
 */
export const MODELO_DEFAULT: ModeloScore = {
  version: 1,
  maximo: 100,
  topesPorFamilia: { perfil: 40, fuente: 15, conversacion: 25, web_citas: 20 },
  decaimiento: { porcentaje: 25, cadaDias: 30, familias: ["conversacion", "web_citas"] },
  tiposExcluidos: ["BROKER_EXTERNO", "EMPLEO", "PROVEEDOR", "OTRO", "REFERIDOR"],
  estadosAnulan: ["DESCARTADO", "PERDIDO", "CONTACTADO_PERDIDO"],
  umbrales: [
    { etiqueta: "MQL", min: 35 },
    { etiqueta: "Calidad media", min: 50 },
    { etiqueta: "SQL", min: 70 },
    { etiqueta: "Calidad alta", min: 80 },
  ],
  reglas: [
    // ── Perfil ──
    {
      id: "plazo", familia: "perfil", tipo: "campo", etiqueta: "Plazo de compra", campo: "purchaseTimeline",
      valores: { IMMEDIATE: 14, ONE_TO_THREE_MONTHS: 9, THREE_TO_SIX_MONTHS: 4, SIX_PLUS_MONTHS: 0 },
    },
    { id: "urgencia", familia: "perfil", tipo: "campo", etiqueta: "Urgencia", campo: "urgency", valores: { ALTA: 6, MEDIA: 3, BAJA: 0 } },
    {
      id: "pago", familia: "perfil", tipo: "campo", etiqueta: "Forma de pago", campo: "paymentMethod",
      valores: { CONTADO: 8, MIXTO: 6, FINANCIAMIENTO_DIRECTO: 5, CREDITO_HIPOTECARIO: 3 },
    },
    {
      id: "presupuesto", familia: "perfil", tipo: "presupuesto", etiqueta: "Presupuesto", tipoCambioUSD: 18,
      escalones: [{ minMXN: 6_000_000, puntos: 10 }, { minMXN: 3_000_000, puntos: 7 }, { minMXN: 1_500_000, puntos: 4 }],
    },
    { id: "perfil_inversion", familia: "perfil", tipo: "campos_presentes", etiqueta: "Perfil de inversión capturado", campos: ["investmentProfile"], puntos: 2 },
    { id: "datos_contacto", familia: "perfil", tipo: "campos_presentes", etiqueta: "Teléfono y correo", campos: ["phone", "email"], puntos: 2 },
    // ── Fuente ──
    {
      id: "fuente", familia: "fuente", tipo: "campo", etiqueta: "Fuente del lead", campo: "leadSource",
      valores: {
        REFERIDO_CLIENTE: 12, WALK_IN: 12, LLAMADA_ENTRANTE: 12, REFERIDO_BROKER: 10,
        WEBSITE: 8, WHATSAPP: 8,
        PORTAL_INMOBILIARIO: 6, EVENTO: 6, WEBINAR: 6,
        FACEBOOK_ADS: 5, META_ADS: 5, INSTAGRAM: 5, GOOGLE_ADS: 5, TIKTOK_ADS: 5, LINKEDIN: 5, MESSENGER: 5,
        // #929: un lead ligado a un broker entra como REGISTRO_BROKER (REFERIDO_BROKER quedó retirado
        // y solo vive en históricos); los dos valen lo mismo.
        REGISTRO_BROKER: 10,
        BASE_DE_DATOS: 0, LLAMADA_FRIA: 0, SELF_GEN: 0, OTRO: 0,
      },
    },
    // ── Conversación ──
    {
      id: "entrantes", familia: "conversacion", tipo: "entrantes", etiqueta: "Respondió / escribió",
      dentroDeDias: 30, puntosPrimera: 10, puntosAdicional: 2, maxPuntos: 16,
    },
    { id: "playbook", familia: "conversacion", tipo: "playbook_completado", etiqueta: "Calificado por el bot", puntos: 8 },
    {
      id: "discovery", familia: "conversacion", tipo: "actividad", etiqueta: "Llamada de descubrimiento",
      tipos: ["DISCOVERY_CALL"], dentroDeDias: 60, puntosPrimera: 6, puntosAdicional: 0,
    },
    // ── Web y citas ──
    {
      id: "cita", familia: "web_citas", tipo: "actividad", etiqueta: "Cita o visita",
      tipos: ["MEETING_VIRTUAL", "MEETING_PRESENTIAL", "MEETING_SHOWROOM", "WALK_IN"], dentroDeDias: 60, puntosPrimera: 15, puntosAdicional: 0,
    },
    {
      id: "propuesta", familia: "web_citas", tipo: "actividad", etiqueta: "Propuesta entregada",
      tipos: ["PROPOSAL_DELIVERY"], dentroDeDias: 60, puntosPrimera: 5, puntosAdicional: 0,
    },
    { id: "web_visitas", familia: "web_citas", tipo: "web", etiqueta: "Visitó el sitio 2+ días", campo: "daysVisited", min: 2, puntos: 3 },
    { id: "web_chat", familia: "web_citas", tipo: "web", etiqueta: "Usó el chat del sitio", campo: "chatCount", min: 1, puntos: 2 },
  ],
};

export const CLAVE_MODELO = "scoring.modelo";
/** Bandera de activación (spec §6 F3). Mientras sea false, el score solo vive en contact_scores. */
export const CLAVE_ACTIVO = "scoring.activo";

/** Valida un modelo guardado; si no sirve, devuelve el default y el motivo. */
export function resolverModelo(valor: unknown): { modelo: ModeloScore; error?: string } {
  if (valor === undefined || valor === null) return { modelo: MODELO_DEFAULT };
  const r = modeloSchema.safeParse(valor);
  if (r.success) return { modelo: r.data };
  return { modelo: MODELO_DEFAULT, error: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
}

/** Ventana más larga que pide cualquier regla de eventos (para acotar la consulta de señales). */
export function ventanaMaxDias(m: ModeloScore): number {
  let max = 1;
  for (const r of m.reglas) if (r.tipo === "actividad" || r.tipo === "entrantes") max = Math.max(max, r.dentroDeDias);
  return max;
}
