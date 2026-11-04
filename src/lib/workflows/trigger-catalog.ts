// Catálogo de disparadores en español (E3, tarjeta 964). Puro: sin React ni BD.
//
// Por qué existe: una regla de flujo se lee "Cuando entra un lead · si … · entonces …". Nadie
// debería elegir `EVENT` + teclear `lead.captured`. Este catálogo traduce lo que el motor
// entiende (`triggerType` + `triggerConfig`, ver `matchesTrigger` en engine.ts y
// `runInactivityRules` en scheduler.ts) a una lista de disparadores con nombre y frase.
// Lo GUARDADO no cambia: `AutomationRule.triggerType/triggerConfig`. Este archivo solo
// convierte entre "disparador de la UI" (key + valor) y lo guardado, con el mismo resultado
// que `buildTriggerConfig`/`parseTriggerValue` de builder-model.ts (se delega en ellos).
//
// ── API (todo exportado de este archivo) ─────────────────────────────────────────────
// Tipos
//   GrupoDeDisparador     "Leads" | "Contacto" | "Negocio" | "Tiempo" | "Otros"
//   CampoDeDisparador     { kind: "select" | "number"; label; opciones?; unidad?; requerido; ayuda? }
//                         `opciones` = value → etiqueta en español (solo kind "select").
//                         `requerido:false` = vacío significa "cualquiera" (p. ej. cualquier etapa).
//   Disparador            { key, frase, fraseSinValor?, label, grupo, triggerType, campo?, contexto,
//                           estado, ayuda? }
//                         `frase` es minúscula y se compone tras "Cuando ": "entra un lead",
//                         "cambia de etapa a {valor}". `{valor}` se sustituye con el valor ya
//                         legible; si el campo es opcional y viene vacío se usa `fraseSinValor`.
//                         `contexto` = qué datos ofrece el constructor de condiciones (E2).
//                         `estado:"proximamente"` = el motor aún no lo ejecuta: no ofrecerlo al crear.
//   DisparadorElegido     { key: string; valor: string }   (lo que edita la UI)
//   DisparadorGuardado    { triggerType: string; triggerConfig: Record<string, unknown> }
// Datos
//   DISPARADORES: Disparador[]          (en orden de presentación; agrupar por `grupo`)
//   GRUPOS_DE_DISPARADOR: GrupoDeDisparador[]   (orden de los grupos)
// Funciones
//   disparadorPorKey(key): Disparador | undefined
//   disparadorDesde(triggerType, triggerConfig): DisparadorElegido
//       Guardado → UI. EVENT con un evento que tiene disparador propio (deal.stage_changed,
//       contact.lifecycle_changed, contact.scored, sla.breach) se presenta con ese disparador
//       (se comportan igual). Un EVENT con un evento desconocido devuelve key = ese evento.
//   triggerConfigDesde(key, valor): Record<string, unknown>
//       UI → `triggerConfig`. Idéntico a `buildTriggerConfig(triggerType, valor)` (EVENT/BEHAVIORAL
//       guardan `{ eventType }`).
//   triggerTypeDe(key): string          UI → `triggerType` ("EVENT" para eventos sueltos).
//   armarDisparador(key, valor): DisparadorGuardado     = { triggerType, triggerConfig } juntos.
//   describeTrigger(triggerType, triggerConfig): string  "entra un lead" (sin el "Cuando ").
//   validarDisparador(key, valor): ResultadoValidacion   { ok, problemas } (umbral/horas numéricos).
//   formatearHoras(horas): string        24 → "24 h", 720 → "30 días" (para frases de inactividad).
import { buildTriggerConfig, parseTriggerValue } from "./builder-model";
import { EVENTOS_DE_CONDICION, type ContextoDeCondicion, type ResultadoValidacion } from "./condition-catalog";
import { STAGE_LABELS, LIFECYCLE_LABELS } from "@/lib/constants";

export type GrupoDeDisparador = "Leads" | "Contacto" | "Negocio" | "Tiempo" | "Otros";

export interface CampoDeDisparador {
  kind: "select" | "number";
  label: string;
  opciones?: Record<string, string>;
  unidad?: string;
  requerido: boolean;
  ayuda?: string;
}

export interface Disparador {
  key: string;
  frase: string;
  fraseSinValor?: string;
  label: string;
  grupo: GrupoDeDisparador;
  triggerType: string;
  campo?: CampoDeDisparador;
  contexto: ContextoDeCondicion;
  estado: "activo" | "proximamente";
  ayuda?: string;
}

export interface DisparadorElegido { key: string; valor: string }
export interface DisparadorGuardado { triggerType: string; triggerConfig: Record<string, unknown> }

export const GRUPOS_DE_DISPARADOR: GrupoDeDisparador[] = ["Leads", "Contacto", "Negocio", "Tiempo", "Otros"];

// Eventos que tienen un disparador propio (con su campo): se presentan con él y no como
// "evento suelto", para no ofrecer dos veces lo mismo. Cambia el `triggerType` guardado pero
// el motor los trata igual: matchesTrigger(EVENT, deal.stage_changed) sin `toStage` = cualquier
// cambio de etapa = matchesTrigger(STAGE_CHANGE) sin `toStage`.
const EVENTO_A_DISPARADOR: Record<string, string> = {
  "deal.stage_changed": "stage_change",
  "contact.lifecycle_changed": "lifecycle_change",
  "contact.scored": "score_threshold",
  "sla.breach": "sla_breach",
};

// Eventos que `emitEvent` NO emite en ningún punto del código (verificado: no hay llamada a
// emitEvent con ese literal en src/ ni scripts/). La regla se puede guardar pero no dispara.
const EVENTOS_SIN_EMISOR = new Set(["contact.merged", "quote.opened", "visit.completed"]);

const etiquetaEvento = (type: string) => EVENTOS_DE_CONDICION[type] ?? type;

// key → { frase, grupo, contexto }. Los eventos con disparador propio no están aquí.
const EVENTOS: Record<string, { frase: string; grupo: GrupoDeDisparador; contexto: ContextoDeCondicion }> = {
  "lead.captured": { frase: "entra un lead", grupo: "Leads", contexto: "contact" },
  "lead.assigned": { frase: "se asigna un lead", grupo: "Leads", contexto: "contact" },
  "lead.reassigned": { frase: "se reasigna un lead", grupo: "Leads", contexto: "contact" },
  "lead.orphaned": { frase: "un lead se queda sin asesor disponible", grupo: "Leads", contexto: "contact" },
  "contact.created": { frase: "se crea un contacto", grupo: "Contacto", contexto: "contact" },
  "contact.merged": { frase: "se fusionan dos contactos", grupo: "Contacto", contexto: "contact" },
  "contact.opted_out": { frase: "un contacto pide no ser contactado", grupo: "Contacto", contexto: "contact" },
  "whatsapp.replied": { frase: "el contacto responde por WhatsApp", grupo: "Contacto", contexto: "contact" },
  "social.replied": { frase: "el contacto responde por Instagram o Messenger", grupo: "Contacto", contexto: "contact" },
  "deal.created": { frase: "se crea un negocio", grupo: "Negocio", contexto: "deal" },
  "deal.won": { frase: "se gana un negocio", grupo: "Negocio", contexto: "deal" },
  "deal.lost": { frase: "se pierde un negocio", grupo: "Negocio", contexto: "deal" },
  // La entidad del evento no es siempre un negocio: "event" ofrece todo, incluido event.type.
  "payment.overdue": { frase: "se atrasa un pago", grupo: "Negocio", contexto: "event" },
  "quote.opened": { frase: "el cliente abre una cotización", grupo: "Negocio", contexto: "event" },
  "visit.completed": { frase: "se realiza una visita", grupo: "Negocio", contexto: "event" },
  "recruitment.apto": { frase: "un candidato resulta apto", grupo: "Otros", contexto: "contact" },
  "recruitment.revisar": { frase: "un candidato queda por revisar", grupo: "Otros", contexto: "contact" },
  "recruitment.no_apto": { frase: "un candidato no resulta apto", grupo: "Otros", contexto: "contact" },
};

const disparadoresDeEvento: Disparador[] = Object.entries(EVENTOS).map(([key, e]) => ({
  key,
  frase: e.frase,
  label: etiquetaEvento(key),
  grupo: e.grupo,
  triggerType: "EVENT",
  contexto: e.contexto,
  estado: EVENTOS_SIN_EMISOR.has(key) ? "proximamente" : "activo",
  ...(EVENTOS_SIN_EMISOR.has(key)
    ? { ayuda: "Todavía no se emite desde el sistema: la regla se guarda pero no se dispara." }
    : {}),
}));

const propio = (key: string) => disparadoresDeEvento.filter((d) => d.key === key);

// Orden de presentación: por grupo, con los disparadores con campo junto a los de su tema.
export const DISPARADORES: Disparador[] = [
  // Leads
  ...propio("lead.captured"), ...propio("lead.assigned"), ...propio("lead.reassigned"), ...propio("lead.orphaned"),
  // Contacto
  ...propio("contact.created"),
  {
    key: "lifecycle_change",
    frase: "cambia de ciclo de vida a {valor}",
    fraseSinValor: "cambia de ciclo de vida",
    label: etiquetaEvento("contact.lifecycle_changed"),
    grupo: "Contacto",
    triggerType: "LIFECYCLE_CHANGE",
    campo: { kind: "select", label: "Etapa del ciclo de vida", opciones: LIFECYCLE_LABELS, requerido: false, ayuda: "Vacío = cualquier cambio." },
    contexto: "contact",
    estado: "activo",
  },
  {
    key: "score_threshold",
    frase: "el score llega a {valor}",
    label: "El score llega a un número",
    grupo: "Contacto",
    triggerType: "SCORE_THRESHOLD",
    campo: { kind: "number", label: "Score mínimo", requerido: true, ayuda: "Dispara cuando el score es igual o mayor." },
    contexto: "contact",
    estado: "activo",
  },
  ...propio("contact.opted_out"), ...propio("whatsapp.replied"), ...propio("social.replied"), ...propio("contact.merged"),
  // Negocio
  ...propio("deal.created"),
  {
    key: "stage_change",
    frase: "cambia de etapa a {valor}",
    fraseSinValor: "cambia de etapa",
    label: etiquetaEvento("deal.stage_changed"),
    grupo: "Negocio",
    triggerType: "STAGE_CHANGE",
    campo: { kind: "select", label: "Etapa del negocio", opciones: STAGE_LABELS, requerido: false, ayuda: "Vacío = cualquier cambio de etapa." },
    contexto: "deal",
    estado: "activo",
  },
  ...propio("deal.won"), ...propio("deal.lost"), ...propio("payment.overdue"),
  ...propio("quote.opened"), ...propio("visit.completed"),
  // Tiempo
  {
    key: "inactivity",
    frase: "lleva {valor} sin actividad",
    label: "Pasa un tiempo sin actividad",
    grupo: "Tiempo",
    triggerType: "INACTIVITY",
    campo: { kind: "number", label: "Horas sin actividad", unidad: "h", requerido: false, ayuda: "Sin valor se usan 24 h." },
    contexto: "contact",
    estado: "activo",
    ayuda: "Lo revisa un proceso programado, no es instantáneo.",
  },
  {
    key: "sla_breach",
    frase: "vence un tiempo de respuesta",
    label: etiquetaEvento("sla.breach"),
    grupo: "Tiempo",
    triggerType: "SLA_BREACH",
    contexto: "event",
    estado: "activo",
  },
  {
    // scheduler.ts no tiene ninguna rama para TIME: la regla se guarda y nunca corre.
    key: "time",
    frase: "llega una fecha u hora programada",
    label: "Programado (fecha u hora)",
    grupo: "Tiempo",
    triggerType: "TIME",
    contexto: "contact",
    estado: "proximamente",
    ayuda: "El motor todavía no ejecuta disparadores por calendario.",
  },
  // Otros
  ...propio("recruitment.apto"), ...propio("recruitment.revisar"), ...propio("recruitment.no_apto"),
  {
    // En engine.ts BEHAVIORAL compara `eventType` igual que EVENT, pero no existe ningún emisor
    // de eventos de comportamiento web: en la práctica nunca dispara.
    key: "behavioral",
    frase: "ocurre «{valor}» en el sitio web",
    fraseSinValor: "ocurre un comportamiento en el sitio web",
    label: "Comportamiento en el sitio web",
    grupo: "Otros",
    triggerType: "BEHAVIORAL",
    campo: { kind: "select", label: "Comportamiento", opciones: EVENTOS_DE_CONDICION, requerido: true },
    contexto: "contact",
    estado: "proximamente",
    ayuda: "No hay eventos de comportamiento web emitiéndose todavía.",
  },
];

const POR_KEY = new Map(DISPARADORES.map((d) => [d.key, d]));

export function disparadorPorKey(key: string): Disparador | undefined {
  return POR_KEY.get(key);
}

// Un TriggerType que no es EVENT tiene exactamente un disparador.
const POR_TRIGGER_TYPE = new Map(
  DISPARADORES.filter((d) => d.triggerType !== "EVENT").map((d) => [d.triggerType, d]),
);

// ── Guardado ⇄ UI ────────────────────────────────────────────────────────────────────
export function disparadorDesde(triggerType: string, triggerConfig: unknown): DisparadorElegido {
  const rule = { triggerConfig: (triggerConfig ?? {}) as Record<string, unknown> };
  // Mismo parseo que el builder actual (eventType ?? toStage ?? stage ?? threshold ?? hours).
  const valor = parseTriggerValue(rule);
  if (triggerType === "EVENT") {
    const evento = typeof rule.triggerConfig.eventType === "string" ? rule.triggerConfig.eventType : "";
    return { key: EVENTO_A_DISPARADOR[evento] ?? evento, valor: "" };
  }
  if (triggerType === "BEHAVIORAL") return { key: "behavioral", valor };
  const d = POR_TRIGGER_TYPE.get(triggerType);
  return { key: d?.key ?? triggerType.toLowerCase(), valor: d?.campo ? valor : "" };
}

export function triggerTypeDe(key: string): string {
  return disparadorPorKey(key)?.triggerType ?? "EVENT";
}

export function triggerConfigDesde(key: string, valor: string): Record<string, unknown> {
  const d = disparadorPorKey(key);
  // Evento suelto (con disparador propio o desconocido): se guarda el evento.
  if (!d) return buildTriggerConfig("EVENT", key) as Record<string, unknown>;
  if (d.triggerType === "EVENT") return buildTriggerConfig("EVENT", key) as Record<string, unknown>;
  if (!d.campo) return {};
  return buildTriggerConfig(d.triggerType, valor) as Record<string, unknown>;
}

export function armarDisparador(key: string, valor: string): DisparadorGuardado {
  return { triggerType: triggerTypeDe(key), triggerConfig: triggerConfigDesde(key, valor) };
}

// ── Lectura en español ───────────────────────────────────────────────────────────────
/** 24 → "24 h", 720 → "30 días" (múltiplos de 24 desde 48 h se dicen en días). */
export function formatearHoras(horas: number): string {
  if (horas >= 48 && horas % 24 === 0) return `${horas / 24} días`;
  return `${horas} h`;
}

const FORMATO_NUMERO = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 2 });

function humanizarClave(raw: string): string {
  return raw.replace(/[._-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim().toLowerCase();
}

function valorLegible(d: Disparador, valor: string): string {
  if (!valor) return "";
  if (d.key === "inactivity") {
    const n = Number(valor);
    return Number.isFinite(n) ? formatearHoras(n) : valor;
  }
  if (d.campo?.kind === "number") {
    const n = Number(valor);
    return Number.isFinite(n) ? FORMATO_NUMERO.format(n) : valor;
  }
  if (d.campo?.opciones) return d.campo.opciones[valor] ?? humanizarClave(valor);
  return valor;
}

export function describeTrigger(triggerType: string, triggerConfig: unknown): string {
  const { key, valor } = disparadorDesde(triggerType, triggerConfig);
  const d = disparadorPorKey(key);
  // Evento que no está en el catálogo: se dice con su nombre, sin clave cruda.
  if (!d) return key ? `ocurre «${EVENTOS_DE_CONDICION[key] ?? humanizarClave(key)}»` : "ocurre un evento sin elegir";
  if (d.key === "inactivity" && !valor) return `lleva ${formatearHoras(24)} sin actividad`;
  if (!d.campo) return d.frase;
  const v = valorLegible(d, valor);
  if (!v) return d.fraseSinValor ?? d.frase.replace("{valor}", "…");
  return d.frase.replace("{valor}", v);
}

// ── Validación ───────────────────────────────────────────────────────────────────────
export function validarDisparador(key: string, valor: string): ResultadoValidacion {
  const problemas: string[] = [];
  const d = disparadorPorKey(key);
  if (!key) problemas.push("Falta elegir el disparador");
  else if (d?.campo) {
    const vacio = valor.trim() === "";
    if (vacio && d.campo.requerido) problemas.push(`${d.label}: falta ${d.campo.label.toLowerCase()}`);
    if (!vacio && d.campo.kind === "number") {
      const n = Number(valor);
      if (!Number.isFinite(n) || n < 0) problemas.push(`${d.campo.label}: debe ser un número`);
      // INACTIVITY con 0 h dispararía para todos los contactos en cada corrida.
      else if (d.key === "inactivity" && n === 0) problemas.push(`${d.campo.label}: debe ser mayor que cero`);
    }
  }
  return { ok: problemas.length === 0, problemas };
}
