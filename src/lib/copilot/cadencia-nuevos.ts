// #988 — Copilot fase 1: la cadencia de nuevos (Nuevo → Sin respuesta, 15 días) y «Mi día».
//
// Fuente: «Cadencia Multicanal — Resumen Operativo» (PDF de Luis, 29-oct), páginas 1, 4 y 5. Lo
// que el PDF no trae sale de las respuestas de Luis (rondas 3 y 4, 02-nov):
//   - una sola tarea por contacto y por día, con los toques de ese día adentro (ronda 4, §5);
//   - los números de otros países llevan la versión México: sin SMS, WhatsApp primero y máximo 4
//     llamadas (ronda 4, §9);
//   - Base de datos lleva una cadencia ligera de 14 días: WhatsApp el día 1, correo el día 7 y
//     WhatsApp de cierre el día 14 (ronda 4, §6);
//   - tope de 40 tareas al día y orden calientes → nuevos en su tiempo → tibios → fríos (ronda 3).
//
// Fase 1 (sistemas@, 02-nov): Copilot NO envía nada. Cada toque es una tarea del asesor con el
// texto listo y el asesor marca el resultado.
//
// Lógica pura: sin Prisma ni React, para que la importen servidor, cliente y pruebas.

export type Canal = "LLAMADA" | "WHATSAPP" | "SMS" | "CORREO" | "BUZON";
export type Pais = "MX" | "US" | "CA" | "OTRO";
export type TipoCadencia = "NUEVOS" | "BASE_DE_DATOS";
export type ModoSms = "COMPLEMENTARIO" | "ROBUSTO";
export type Franja = "MANANA" | "TARDE";

export const CANAL_LABELS: Record<Canal, string> = {
  LLAMADA: "Llamada",
  WHATSAPP: "WhatsApp",
  SMS: "SMS",
  CORREO: "Correo",
  BUZON: "Buzón de voz",
};

export const TIPO_CADENCIA_LABELS: Record<TipoCadencia, string> = {
  NUEVOS: "Cadencia de nuevos",
  BASE_DE_DATOS: "Cadencia ligera (Base de datos)",
};

/** Último día con toques. Al día siguiente la cadencia termina (flujograma: → Perdido). */
export const ULTIMO_DIA: Record<TipoCadencia, number> = { NUEVOS: 15, BASE_DE_DATOS: 14 };

/** Tope de tareas que se le muestran al asesor en «Mi día» (Luis, ronda 3). */
export const TOPE_TAREAS_DIA = 40;

/** Una tarea sin marcar se pone en rojo y avisa al gerente a las 24 h (sistemas@, 05-nov). */
export const VENCIDA_MS = 24 * 3_600_000;

// ───────────────────────────── país del teléfono ─────────────────────────────

/** Ladas de Canadá dentro del +1 (NANP). El resto del +1 es EE. UU. salvo el Caribe. */
const LADAS_CANADA = new Set([
  "204", "226", "236", "249", "250", "257", "263", "289", "306", "343", "354", "365", "367", "368",
  "382", "403", "416", "418", "428", "431", "437", "438", "450", "468", "474", "506", "514", "519",
  "548", "579", "581", "584", "587", "600", "604", "613", "639", "647", "672", "683", "705", "709",
  "742", "753", "778", "780", "782", "807", "819", "825", "867", "873", "879", "902", "905",
]);
/** Países del Caribe con +1 que no son EE. UU. ni Canadá: llevan la versión México («otro país»). */
const LADAS_CARIBE = new Set([
  "242", "246", "264", "268", "284", "345", "441", "473", "649", "658", "664", "721", "758", "767",
  "784", "809", "829", "849", "868", "869", "876",
]);

/**
 * País de la cadencia a partir del teléfono ya normalizado (E.164). Sin teléfono se toma México:
 * el calendario es el mismo y los toques de teléfono salen como «sin teléfono».
 */
export function paisDeTelefono(e164: string | null | undefined): Pais {
  const s = (e164 ?? "").trim();
  if (!s.startsWith("+")) return "MX";
  if (s.startsWith("+52")) return "MX";
  const nanp = s.match(/^\+1(\d{3})\d{7}$/);
  if (nanp) {
    if (LADAS_CANADA.has(nanp[1])) return "CA";
    if (LADAS_CARIBE.has(nanp[1])) return "OTRO";
    return "US";
  }
  return "OTRO";
}

export const PAIS_LABELS: Record<Pais, string> = {
  MX: "México",
  US: "Estados Unidos",
  CA: "Canadá",
  OTRO: "Otro país",
};

// ───────────────────────────── calendario ─────────────────────────────

export interface PerfilCadencia {
  tipo: TipoCadencia;
  pais: Pais;
  /** Fuente del lead (LeadSource): cambia la plantilla del primer WhatsApp. */
  fuente: string | null;
  /** Solo EE. UU.: el lead ya escribió por WhatsApp (Meta bloquea el saliente si no). */
  waAbierto: boolean;
  /** Solo EE. UU.: se decide el día 4. null antes. */
  modoSms: ModoSms | null;
  /** Hora (0–23, Cancún) a la que entró a la cadencia: decide la franja de la L1. */
  horaEntrada: number;
}

export interface ToquePlan {
  /** Único por cadencia: L1…L7, WA1…WA5, CORREO1…CORREO5, SMS1…SMS4, BUZON1, BUZON2. */
  codigo: string;
  canal: Canal;
  dia: number;
  /** Orden dentro del día. */
  orden: number;
  /** Código de la plantilla (copilot_plantillas.codigo). null en las llamadas: llevan guion. */
  plantilla: string | null;
  /** Cuándo hacerlo, en palabras («En menos de 5 min», «Tarde, 16:00–20:00»…). */
  cuando: string;
}

const FRANJA_TEXTO: Record<Franja, string> = {
  MANANA: "Mañana, 9:00–13:00 (hora del lead)",
  TARDE: "Tarde, 16:00–20:00 (hora del lead)",
};

function opuesta(f: Franja): Franja {
  return f === "MANANA" ? "TARDE" : "MANANA";
}

/** Franja de la L1 según la hora de entrada: antes de las 14:00 es la mañana. */
export function franjaInicial(horaEntrada: number): Franja {
  return horaEntrada < 14 ? "MANANA" : "TARDE";
}

/**
 * Cuándo va cada llamada. La L1 en menos de 5 min; de ahí en adelante se rota la franja
 * (PDF: «L2 tarde (franja opuesta)», «L3 (franja distinta)», «Rotar horario»).
 */
export function cuandoLlamada(n: number, horaEntrada: number): string {
  if (n === 1) {
    if (horaEntrada >= 9 && horaEntrada < 20) return "En menos de 5 min desde que entró";
    return "A primera hora (entró fuera del horario de 9:00 a 20:00)";
  }
  const f0 = franjaInicial(horaEntrada);
  return FRANJA_TEXTO[n % 2 === 0 ? opuesta(f0) : f0];
}

/** El WhatsApp puede salir: México, Canadá y otros países siempre; EE. UU. solo si el lead escribió. */
function waPermitido(p: PerfilCadencia): boolean {
  return p.pais !== "US" || p.waAbierto;
}

/** Plantilla del primer WhatsApp según la fuente (Luis, ronda 4, §6). */
export function plantillaPrimerWhatsApp(fuente: string | null, tipo: TipoCadencia): string {
  if (tipo === "BASE_DE_DATOS") return "WA1_BASE_DE_DATOS";
  if (fuente === "SELF_GEN") return "WA1_SELF_GEN";
  if (fuente === "WALK_IN") return "WA1_WALK_IN";
  if (fuente === "EVENTO") return "WA1_EVENTO";
  return "WA1";
}

/** Plantilla del SMS: complementario (con o sin WhatsApp) o robusto. */
function plantillaSms(n: number, p: PerfilCadencia): string {
  if (n === 1) return waPermitido(p) ? "SMS_C1_CON_WA" : "SMS_C1_SIN_WA";
  return p.modoSms === "ROBUSTO" ? `SMS_R${n}` : `SMS_C${n}`;
}

/**
 * Modo de SMS de EE. UU. (PDF: «complementario → robusto si nunca entra a WhatsApp, se decide
 * ~día 4»). Canadá siempre es complementario. México y otros países no llevan SMS.
 */
export function modoSmsDelDia4(pais: Pais, waAbierto: boolean): ModoSms | null {
  if (pais === "CA") return "COMPLEMENTARIO";
  if (pais === "US") return waAbierto ? "COMPLEMENTARIO" : "ROBUSTO";
  return null;
}

/** Días con SMS por modo (PDF, sección 4). El SMS1 del día 1 va en los dos. */
const SMS_POR_DIA: Record<ModoSms, Record<number, number>> = {
  COMPLEMENTARIO: { 1: 1, 6: 2, 12: 3 },
  ROBUSTO: { 1: 1, 4: 2, 8: 3, 13: 4 },
};

/** Las 7 llamadas de la cadencia de nuevos: días 1 (×2), 2, 4, 7, 10 y 13. */
const LLAMADAS_NUEVOS: Record<number, number[]> = { 1: [1, 2], 2: [3], 4: [4], 7: [5], 10: [6], 13: [7] };
/** Otros países: máximo 4 llamadas (Luis, ronda 4, §9), repartidas en los días 1, 4, 7 y 13. */
const LLAMADAS_OTRO_PAIS: Record<number, number[]> = { 1: [1], 4: [4], 7: [5], 13: [7] };
const WHATSAPP_NUEVOS: Record<number, number> = { 1: 1, 4: 2, 7: 3, 10: 4, 13: 5 };
const CORREO_NUEVOS: Record<number, number> = { 2: 1, 5: 2, 8: 3, 11: 4, 15: 5 };

/**
 * Los toques de un día de la cadencia, en el orden en que se hacen. Vacío si el día no tiene
 * toques o ya pasó el último día.
 */
export function toquesDelDia(dia: number, p: PerfilCadencia): ToquePlan[] {
  if (!Number.isInteger(dia) || dia < 1 || dia > ULTIMO_DIA[p.tipo]) return [];
  return p.tipo === "BASE_DE_DATOS" ? toquesBaseDeDatos(dia, p) : toquesNuevos(dia, p);
}

function toquesNuevos(dia: number, p: PerfilCadencia): ToquePlan[] {
  const out: Omit<ToquePlan, "orden">[] = [];
  const masUno = p.pais === "US" || p.pais === "CA";
  const otroPais = p.pais === "OTRO";
  const llamadas = (otroPais ? LLAMADAS_OTRO_PAIS : LLAMADAS_NUEVOS)[dia] ?? [];
  const wa = waPermitido(p) ? WHATSAPP_NUEVOS[dia] : undefined;

  // Otros países: «WhatsApp primero» (ronda 4, §9).
  if (otroPais && wa) out.push(toqueWhatsApp(wa, dia, p, "Antes de la llamada"));

  for (const n of llamadas) {
    out.push({ codigo: `L${n}`, canal: "LLAMADA", dia, plantilla: null, cuando: cuandoLlamada(n, p.horaEntrada) });
    // El WhatsApp va después de la primera llamada del día (PDF, día 1: L1, WA1, SMS1, L2).
    if (!otroPais && wa && n === llamadas[0]) out.push(toqueWhatsApp(wa, dia, p, `Después de la L${n}`));
    if (masUno && dia === 1 && n === llamadas[0]) {
      const sms = smsDelDia(dia, p);
      if (sms) out.push(sms);
    }
    // Buzón de voz: solo +1, tras la L2 (día 1) y la L6 (día 10).
    if (masUno && (n === 2 || n === 6)) {
      out.push({
        codigo: n === 2 ? "BUZON1" : "BUZON2",
        canal: "BUZON",
        dia,
        plantilla: n === 2 ? "BUZON1" : "BUZON2",
        cuando: `Si la L${n} no contesta (menos de 20 s)`,
      });
    }
  }
  // Días con WhatsApp y sin llamada (no pasa en México; queda por si se edita el calendario).
  if (!otroPais && wa && llamadas.length === 0) out.push(toqueWhatsApp(wa, dia, p, "En horario laboral"));
  if (masUno && dia !== 1) {
    const sms = smsDelDia(dia, p);
    if (sms) out.push(sms);
  }

  // Correo: EE. UU. adelanta el Correo 1 al día 1 (a la par).
  const correo = p.pais === "US" ? (dia === 1 ? 1 : dia === 2 ? undefined : CORREO_NUEVOS[dia]) : CORREO_NUEVOS[dia];
  if (correo) {
    out.push({ codigo: `CORREO${correo}`, canal: "CORREO", dia, plantilla: `CORREO${correo}`, cuando: "En horario laboral" });
  }
  return out.map((t, i) => ({ ...t, orden: i + 1 }));
}

function toqueWhatsApp(n: number, dia: number, p: PerfilCadencia, cuando: string): Omit<ToquePlan, "orden"> {
  return {
    codigo: `WA${n}`,
    canal: "WHATSAPP",
    dia,
    plantilla: n === 1 ? plantillaPrimerWhatsApp(p.fuente, p.tipo) : `WA${n}`,
    cuando,
  };
}

function smsDelDia(dia: number, p: PerfilCadencia): Omit<ToquePlan, "orden"> | null {
  if (p.pais !== "US" && p.pais !== "CA") return null;
  // Antes del día 4 (o en Canadá) el modo es complementario.
  const modo: ModoSms = p.pais === "CA" ? "COMPLEMENTARIO" : p.modoSms ?? "COMPLEMENTARIO";
  const n = SMS_POR_DIA[modo][dia];
  if (!n) return null;
  return { codigo: `SMS${n}`, canal: "SMS", dia, plantilla: plantillaSms(n, { ...p, modoSms: modo }), cuando: "Junto con el WhatsApp o la llamada" };
}

/**
 * Base de datos (Luis, ronda 4, §6): WhatsApp el día 1, correo el día 7 y WhatsApp de cierre el día
 * 14; llamada solo a quien responda (y al responder ya sale de la cadencia). A EE. UU. sin WhatsApp
 * se le manda el SMS equivalente.
 */
function toquesBaseDeDatos(dia: number, p: PerfilCadencia): ToquePlan[] {
  const wa = waPermitido(p);
  if (dia === 1) {
    return [
      wa
        ? { codigo: "WA1", canal: "WHATSAPP", dia, orden: 1, plantilla: "WA1_BASE_DE_DATOS", cuando: "En horario laboral" }
        : { codigo: "SMS1", canal: "SMS", dia, orden: 1, plantilla: "SMS_C1_SIN_WA", cuando: "En horario laboral" },
    ];
  }
  if (dia === 7) return [{ codigo: "CORREO2", canal: "CORREO", dia, orden: 1, plantilla: "CORREO2", cuando: "En horario laboral" }];
  if (dia === 14) {
    return [
      wa
        ? { codigo: "WA5", canal: "WHATSAPP", dia, orden: 1, plantilla: "WA5", cuando: "En horario laboral" }
        : { codigo: "SMS4", canal: "SMS", dia, orden: 1, plantilla: "SMS_R4", cuando: "En horario laboral" },
    ];
  }
  return [];
}

/** Todo el calendario (para mostrar lo que falta en la ficha). Usa el modo de SMS que se le pase. */
export function calendarioCompleto(p: PerfilCadencia): ToquePlan[] {
  const out: ToquePlan[] = [];
  for (let d = 1; d <= ULTIMO_DIA[p.tipo]; d++) out.push(...toquesDelDia(d, p));
  return out;
}

// ───────────────────────────── días ─────────────────────────────

const DIA_MS = 86_400_000;
/** Cancún está en UTC−5 todo el año (sin horario de verano desde 2015). */
const CANCUN_OFFSET_MS = -5 * 3_600_000;

/** Fecha civil de Cancún (AAAA-MM-DD) de un instante. */
export function fechaCancun(d: Date): string {
  return new Date(d.getTime() + CANCUN_OFFSET_MS).toISOString().slice(0, 10);
}

/** Hora (0–23) de Cancún de un instante. */
export function horaCancun(d: Date): number {
  return new Date(d.getTime() + CANCUN_OFFSET_MS).getUTCHours();
}

/** Número de día de la cadencia (1 = el día en que entró), contado en días civiles de Cancún. */
export function diaDeCadencia(diaInicio: string, ahora: Date): number {
  const a = Date.parse(`${diaInicio}T00:00:00Z`);
  const b = Date.parse(`${fechaCancun(ahora)}T00:00:00Z`);
  return Math.floor((b - a) / DIA_MS) + 1;
}

/** Fecha civil del día N de la cadencia. */
export function fechaDelDia(diaInicio: string, dia: number): string {
  return new Date(Date.parse(`${diaInicio}T00:00:00Z`) + (dia - 1) * DIA_MS).toISOString().slice(0, 10);
}

// ───────────────────────────── resultados ─────────────────────────────

export type Resultado =
  | "CONTESTO"
  | "NO_CONTESTO"
  | "DEJADO"
  | "ENVIADO"
  | "RESPONDIO"
  | "NO_SE_PUDO"
  | "NO_HECHO";

export const RESULTADO_LABELS: Record<Resultado, string> = {
  CONTESTO: "Contestó una persona",
  NO_CONTESTO: "No contestó",
  DEJADO: "Lo dejé",
  ENVIADO: "Enviado",
  RESPONDIO: "Respondió",
  NO_SE_PUDO: "No se pudo",
  NO_HECHO: "No se hizo",
};

/** Lo que el asesor puede marcar en cada canal. NO_HECHO lo pone el sistema al terminar. */
export const RESULTADOS_POR_CANAL: Record<Canal, readonly Resultado[]> = {
  LLAMADA: ["CONTESTO", "NO_CONTESTO", "NO_SE_PUDO"],
  WHATSAPP: ["ENVIADO", "RESPONDIO", "NO_SE_PUDO"],
  SMS: ["ENVIADO", "RESPONDIO", "NO_SE_PUDO"],
  CORREO: ["ENVIADO", "RESPONDIO", "NO_SE_PUDO"],
  BUZON: ["DEJADO", "NO_SE_PUDO"],
};

export function esResultadoDelCanal(canal: string, r: unknown): r is Resultado {
  const lista = (RESULTADOS_POR_CANAL as Record<string, readonly string[]>)[canal];
  return !!lista && typeof r === "string" && lista.includes(r);
}

/**
 * Respuesta del lead: pausa la cadencia y pasa a Contactado (PDF: «se pausa al primer "responde"
 * por cualquier canal; una llamada conectada cuenta»). El buzón no es respuesta.
 */
export function esRespuesta(r: string | null | undefined): boolean {
  return r === "CONTESTO" || r === "RESPONDIO";
}

/** Un intento de contacto: mueve Nuevo → Sin respuesta (flujograma: «justo después de la primera actividad»). */
export function esIntento(r: string | null | undefined): boolean {
  return r === "NO_CONTESTO" || r === "DEJADO" || r === "ENVIADO";
}

// ───────────────────────────── «Mi día» ─────────────────────────────

export interface TareaParaOrdenar {
  /** contact_temperaturas.orden (0 Caliente … 40 Muerto); null si aún no se calcula. */
  ordenTemperatura: number | null;
  dia: number;
  fecha: string;
  /** Tiene la L1 pendiente: es un nuevo dentro de su tiempo. */
  l1Pendiente: boolean;
  inicio: Date | string;
}

/**
 * Orden de «Mi día» (Luis, ronda 3): calientes → nuevos dentro de su tiempo (L1 pendiente) → el
 * resto por temperatura (Tibio A, Tibio B, Frío). Dentro del mismo grupo, primero lo más atrasado.
 * «Una tarea caliente nunca queda detrás de una fría.»
 */
export function compararTareas(a: TareaParaOrdenar, b: TareaParaOrdenar): number {
  const grupo = (t: TareaParaOrdenar) => (t.ordenTemperatura === 0 ? 0 : t.l1Pendiente ? 1 : 2);
  const g = grupo(a) - grupo(b);
  if (g !== 0) return g;
  const ta = a.ordenTemperatura ?? 25;
  const tb = b.ordenTemperatura ?? 25;
  if (ta !== tb) return ta - tb;
  if (a.fecha !== b.fecha) return a.fecha < b.fecha ? -1 : 1;
  return new Date(b.inicio).getTime() - new Date(a.inicio).getTime();
}

/** Vencida: lleva 24 h o más sin marcar desde que apareció en «Mi día». */
export function estaVencida(creadoAt: Date | string, ahora: Date): boolean {
  return ahora.getTime() - new Date(creadoAt).getTime() >= VENCIDA_MS;
}

// ───────────────────────────── a quién aplica ─────────────────────────────

/** Tipos de contacto que no llevan la cadencia de compradores. Paridad con el SQL: cadencia-nuevos.test.ts. */
export const TIPOS_SIN_CADENCIA = ["BROKER_EXTERNO", "EMPLEO", "PROVEEDOR", "LEAD_VENDEDOR", "OTRO"] as const;
/**
 * Flujos que no son de un comprador: vendedor, captación de desarrolladores, broker, inmobiliaria y
 * empleo. F2, F4 y F5 sí son de compra (Luis, ronda 4, §2 y §10) y los llevan igual que «Sin flujo».
 */
export const FLUJOS_SIN_CADENCIA = [
  "F1_CORRETAJE_VENDEDOR",
  "F3_CAPTACION_MB",
  "F6_BROKER",
  "F7_INMOBILIARIA",
  "F8_EMPLEO",
] as const;
