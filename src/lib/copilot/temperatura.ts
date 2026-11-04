// #973 — Temperatura calculada (Copilot, fase 1). Reglas de Luis (3.ª y 4.ª ronda, 02-nov) y
// decisiones de sistemas@ (04-nov). Función pura: no lee la base; el cron le pasa los datos
// (lib/copilot/temperatura-recalcular.ts).
//
// Estado y temperatura son dos cosas: la temperatura nunca mueve estados, solo ordena tareas.
// El asesor ve Caliente, Tibio o Frío (y Muerto); Tibio A / Tibio B solo ordenan y van en un reporte.
//
//   1. No aplica: Registrado por broker y Derivado a RH (sin tareas de contacto en Copilot).
//   2. Muerto: No contactar, Perdido · Datos incorrectos o Spam, Contactado perdido · No califica.
//   3. Caliente: señal de compra en las últimas 72 h; o Propuesta en adelante y respondió en 7 días;
//      o fuente caliente (Llamada entrante, Walk-in) y entró o respondió en los últimos 7 días.
//   4. Si no, la de su fuente: Tibio A, Tibio B o Frío. Una fuente caliente que ya pasó sus 7 días
//      queda en Tibio A.
//   5. Enfriamiento, contado desde la última respuesta (o la entrada si nunca respondió), solo en
//      nutrición —las salidas— o en Base de datos: Tibio B → Frío a los 30 días, Tibio A a los 60.

import type { Estado } from "@/lib/estados";

export type Temperatura = "HOT" | "WARM" | "COLD" | "DEAD";
export type GrupoTibio = "A" | "B";
type GrupoFuente = "CALIENTE" | GrupoTibio | "FRIO";

const DIA = 86_400_000;
const HORA = 3_600_000;

/** Temperatura inicial por fuente (Luis, 3.ª ronda + 4.ª ronda pregunta 7; sistemas@ 04-nov). */
export const GRUPO_POR_FUENTE: Record<string, GrupoFuente> = {
  LLAMADA_ENTRANTE: "CALIENTE",
  WALK_IN: "CALIENTE",
  REFERIDO_CLIENTE: "A", // el primero de la lista
  REFERIDO_BROKER: "A",
  REGISTRO_BROKER: "A", // = referido de broker mientras no esté «Registrado por broker»
  WEBSITE: "A",
  WHATSAPP: "A",
  GOOGLE_ADS: "A",
  PORTAL_INMOBILIARIO: "A",
  EVENTO: "A",
  META_ADS: "B",
  FACEBOOK_ADS: "B",
  INSTAGRAM: "B",
  MESSENGER: "B",
  TIKTOK_ADS: "B",
  WEBINAR: "B", // Tibio A si asistió: falta el campo «Asistió» (sistemas@ 04-nov)
  LINKEDIN: "B", // Tibio A si el lead escribió primero: el CRM no lo distingue todavía
  OTRO: "B",
  BASE_DE_DATOS: "FRIO",
  SELF_GEN: "FRIO", // solo prospección propia (Luis, 4.ª ronda)
  LLAMADA_FRIA: "FRIO",
};

const FUENTE_LABEL: Record<string, string> = {
  LLAMADA_ENTRANTE: "llamada entrante",
  WALK_IN: "walk-in",
  REFERIDO_CLIENTE: "referido de cliente",
  REFERIDO_BROKER: "referido de broker",
  REGISTRO_BROKER: "registro de broker",
  WEBSITE: "sitio web",
  WHATSAPP: "WhatsApp",
  GOOGLE_ADS: "Google Ads",
  PORTAL_INMOBILIARIO: "portal inmobiliario",
  EVENTO: "evento",
  META_ADS: "Meta Ads",
  FACEBOOK_ADS: "Facebook Ads",
  INSTAGRAM: "Instagram",
  MESSENGER: "Messenger",
  TIKTOK_ADS: "TikTok Ads",
  WEBINAR: "webinar",
  LINKEDIN: "LinkedIn",
  OTRO: "otra fuente",
  BASE_DE_DATOS: "base de datos",
  SELF_GEN: "prospección propia",
  LLAMADA_FRIA: "llamada en frío",
};

const SALIDAS: readonly string[] = ["PERDIDO", "CONTACTADO_PERDIDO", "NEGOCIO_PERDIDO"];
const NO_APLICA: readonly string[] = ["REGISTRADO_POR_BROKER", "DERIVADO_A_RH"];
const DE_PROPUESTA_EN_ADELANTE: readonly Estado[] = ["PROPUESTA", "APARTADO", "FIRMA", "ESCRITURA", "POSTVENTA"];

export const VENTANA_SENAL_MS = 72 * HORA;
export const VENTANA_CALIENTE_MS = 7 * DIA;
export const ENFRIA_B_MS = 30 * DIA;
export const ENFRIA_A_MS = 60 * DIA;

/**
 * Señal de compra en el texto de un mensaje del lead (sistemas@ 04-nov: palabras, no IA). Español e
 * inglés (hay leads de EE. UU. y Canadá). Lista corta y explícita: preferible que se escape una
 * señal a que «hola» caliente a alguien.
 */
export const SENAL_DE_COMPRA =
  /\b(precios?|cu[aá]nto (cuesta|cuestan|sale|salen|vale|valen)|costos?|cotizaci[oó]n|cotizar|disponib(le|les|ilidad)|plan(es)? de pagos?|esquemas? de pago|financiamiento|cr[eé]dito|corrida|enganche|mensualidad(es)?|apart(ar|ado|arlo|arla|o)|reservar|separar|price|prices|pricing|how much|cost|available|availability|payment plan|down ?payment|financing|mortgage|reserve|reservation)\b/i;

export function esSenalDeCompra(texto: string | null | undefined): boolean {
  return !!texto && SENAL_DE_COMPRA.test(texto);
}

export interface EntradaTemperatura {
  fuente: string | null;
  estado: string | null;
  razonSalida: string | null;
  doNotContact: boolean;
  /** Cuándo entró el contacto (la fecha original si viene de una importación). */
  entradaAt: Date;
  /** La última vez que el lead respondió por cualquier canal (o contestó una llamada). */
  ultimaRespuestaAt: Date | null;
  /** La señal de compra más reciente y qué fue («preguntó por precio», «agendó reunión»…). */
  senalCompraAt: Date | null;
  senalCompra?: string | null;
}

export interface ResultadoTemperatura {
  temperatura: Temperatura | null;
  grupo: GrupoTibio | null;
  /** Más chico = primero en «Mi día» (ver ORDEN). Una tarea caliente nunca queda detrás de una fría. */
  orden: number;
  motivo: string;
}

function hace(ms: number): string {
  const h = Math.round(ms / HORA);
  if (h < 1) return "hace menos de una hora";
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.round(ms / DIA)} días`;
}

/** Orden dentro de «Mi día»: más chico = primero. Referido de cliente va primero entre los Tibio A. */
export const ORDEN = { CALIENTE: 0, TIBIO_A_REFERIDO: 10, TIBIO_A: 11, TIBIO_B: 20, FRIO: 30, MUERTO: 40, NO_APLICA: 90 } as const;

function ordenDe(t: Temperatura | null, grupo: GrupoTibio | null, fuente: string | null): number {
  if (t === "HOT") return ORDEN.CALIENTE;
  if (t === "WARM") return grupo === "A" ? (fuente === "REFERIDO_CLIENTE" ? ORDEN.TIBIO_A_REFERIDO : ORDEN.TIBIO_A) : ORDEN.TIBIO_B;
  if (t === "COLD") return ORDEN.FRIO;
  if (t === "DEAD") return ORDEN.MUERTO;
  return ORDEN.NO_APLICA;
}

export function calcularTemperatura(e: EntradaTemperatura, ahora: Date = new Date()): ResultadoTemperatura {
  const fuente = e.fuente ?? null;
  const resultado = (temperatura: Temperatura | null, grupo: GrupoTibio | null, motivo: string): ResultadoTemperatura => ({
    temperatura,
    grupo,
    orden: ordenDe(temperatura, grupo, fuente),
    motivo,
  });

  // 1. No aplica.
  if (e.estado === "REGISTRADO_POR_BROKER") return resultado(null, null, "No aplica: lo acompaña su broker");
  if (e.estado === "DERIVADO_A_RH") return resultado(null, null, "No aplica: derivado a RH");

  // 2. Muerto.
  if (e.doNotContact || e.razonSalida === "NO_CONTACTAR") return resultado("DEAD", null, "Muerto: pidió no ser contactado");
  if (e.estado === "PERDIDO" && (e.razonSalida === "DATOS_INCORRECTOS" || e.razonSalida === "SPAM")) {
    return resultado("DEAD", null, e.razonSalida === "SPAM" ? "Muerto: spam" : "Muerto: datos incorrectos");
  }
  if (e.estado === "CONTACTADO_PERDIDO" && e.razonSalida === "NO_CALIFICA") return resultado("DEAD", null, "Muerto: no califica");

  // 3. Caliente.
  const t = ahora.getTime();
  if (e.senalCompraAt && t - e.senalCompraAt.getTime() <= VENTANA_SENAL_MS) {
    return resultado("HOT", null, `Caliente: ${e.senalCompra ?? "señal de compra"} ${hace(t - e.senalCompraAt.getTime())}`);
  }
  const respondioReciente = !!e.ultimaRespuestaAt && t - e.ultimaRespuestaAt.getTime() <= VENTANA_CALIENTE_MS;
  if (respondioReciente && e.estado && (DE_PROPUESTA_EN_ADELANTE as readonly string[]).includes(e.estado)) {
    return resultado("HOT", null, `Caliente: en propuesta o más adelante y respondió ${hace(t - e.ultimaRespuestaAt!.getTime())}`);
  }
  const grupoFuente: GrupoFuente = (fuente && GRUPO_POR_FUENTE[fuente]) || "B";
  const nombreFuente = (fuente && FUENTE_LABEL[fuente]) || "fuente sin clasificar";
  if (grupoFuente === "CALIENTE") {
    const ref = e.ultimaRespuestaAt ?? e.entradaAt;
    if (t - ref.getTime() <= VENTANA_CALIENTE_MS) return resultado("HOT", null, `Caliente: ${nombreFuente}`);
  }

  // 4. La de su fuente; 5. enfriamiento solo en nutrición o en Base de datos.
  if (grupoFuente === "FRIO") return resultado("COLD", null, `Frío: ${nombreFuente}`);
  const grupo: GrupoTibio = grupoFuente === "B" ? "B" : "A"; // una fuente caliente vencida queda en A
  const enNutricion = (!!e.estado && SALIDAS.includes(e.estado)) || fuente === "BASE_DE_DATOS";
  if (enNutricion) {
    const ref = e.ultimaRespuestaAt ?? e.entradaAt;
    const limite = grupo === "B" ? ENFRIA_B_MS : ENFRIA_A_MS;
    if (t - ref.getTime() > limite) {
      return resultado("COLD", null, `Frío: sin responder desde ${hace(t - ref.getTime())} (${nombreFuente})`);
    }
  }
  const sufijo = grupoFuente === "CALIENTE" ? " (pasaron 7 días sin respuesta)" : "";
  return resultado("WARM", grupo, `Tibio: ${nombreFuente}${sufijo}`);
}

/** Etiqueta para la ficha y la lista. */
export function etiquetaTemperatura(t: string | null | undefined): string {
  switch (t) {
    case "HOT":
      return "Caliente";
    case "WARM":
      return "Tibio";
    case "COLD":
      return "Frío";
    case "DEAD":
      return "Muerto";
    default:
      return "Sin temperatura";
  }
}
