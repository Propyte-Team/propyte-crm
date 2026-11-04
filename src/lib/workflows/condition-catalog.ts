// Catálogo de condiciones en español (E2, tarjeta 963). Puro: sin React ni BD.
//
// Por qué existe: nadie debería teclear `contact.leadSource`. Este catálogo dice qué datos
// puede usar una condición, de qué tipo son, qué operadores les corresponden y cómo se leen en
// español. La UI (condition-tree.tsx) y los resúmenes (reglas de reparto, cadencias, flujos)
// salen de aquí, de modo que haya UNA sola lista. El DSL guardado y el evaluador
// (`evaluate-conditions.ts`) NO cambian: `{ all|any: [{ field, op, value }] }`.
//
// ── API (todo exportado de este archivo) ─────────────────────────────────────────────
// Tipos
//   TipoDeCampo            "enum" | "number" | "text" | "boolean"  (no hay campos de fecha en el evaluador)
//   GrupoDeCampo           "Contacto" | "Perfil de inversión" | "Calificación" | "Anuncio (Meta)" | "Negocio" | "Evento" | "Contexto"
//   ContextoDeCondicion    "contact" | "deal" | "event"
//   CampoDeCondicion       { key, label, frase?, grupo, tipo, opciones?, contextos, ayuda? }
//                          `label` = nombre para el selector ("Presupuesto máx."); `frase` = forma corta
//                          en minúsculas para leer la condición ("presupuesto máx."), si falta se deriva de `label`.
//   OperadorDeCondicion    { value: string; label: string }
//   ValorEditable          string | string[] | boolean   (forma que edita la UI)
//   ResultadoValidacion    { ok: boolean; problemas: string[] }
// Datos
//   CAMPOS_DE_CONDICION: CampoDeCondicion[]
//   GRUPOS_DE_CAMPO: GrupoDeCampo[]                      (orden de presentación)
//   EVENTOS_DE_CONDICION: Record<string, string>         (event.type → etiqueta)
//   FIELD_LABELS: Record<string, string>                 (key → frase corta; lo usa rules-model)
//   FIELD_VALUE_LABELS: Record<string, Record<string,string>>  (key de enum → diccionario de valores)
// Funciones
//   camposPara(contexto: ContextoDeCondicion): CampoDeCondicion[]
//   campoPorKey(key: string): CampoDeCondicion | undefined
//   operadoresPara(tipo: TipoDeCampo): OperadorDeCondicion[]
//   operadorExigeValor(op: string): boolean              (todos salvo "exists")
//   valorParaGuardar(campo: CampoDeCondicion | undefined, op: string, raw: string | string[] | boolean | number): unknown
//   valorDesdeDsl(campo: CampoDeCondicion | undefined, op: string, value: unknown): ValorEditable
//   describeConditions(conditions: unknown, opts?: { vacio?: string }): string
//   validarCondiciones(conditions: unknown): ResultadoValidacion
// valorParaGuardar/valorDesdeDsl convierten entre lo que edita la UI y lo que guarda el DSL
// (son inversas); describeConditions y validarCondiciones leen el DSL ya armado.
import {
  LEAD_SOURCE_LABELS, CONTACT_TYPE_LABELS, PLAZA_LABELS, LEAD_TEMPERATURE_LABELS,
  CONTACT_STATUS_LABELS, LIFECYCLE_LABELS, URGENCY_LABELS, DEAL_TYPE_LABELS, LOST_REASON_LABELS,
  CURRENCY_LABELS, STAGE_LABELS,
} from "@/lib/constants";
import { PREFERRED_LANGUAGE_LABELS, PROPERTY_TYPE_LABELS, etiqueta } from "@/lib/labels";

export type TipoDeCampo = "enum" | "number" | "text" | "boolean";
export type GrupoDeCampo =
  | "Contacto" | "Perfil de inversión" | "Calificación" | "Anuncio (Meta)" | "Negocio" | "Evento" | "Contexto";
export type ContextoDeCondicion = "contact" | "deal" | "event";

export interface CampoDeCondicion {
  key: string;
  label: string;
  frase?: string;
  grupo: GrupoDeCampo;
  tipo: TipoDeCampo;
  opciones?: Record<string, string>;
  contextos: ContextoDeCondicion[];
  ayuda?: string;
}
export interface OperadorDeCondicion { value: string; label: string }
export type ValorEditable = string | string[] | boolean;
export interface ResultadoValidacion { ok: boolean; problemas: string[] }

export const GRUPOS_DE_CAMPO: GrupoDeCampo[] = [
  "Contacto", "Perfil de inversión", "Calificación", "Anuncio (Meta)", "Negocio", "Evento", "Contexto",
];

// Diccionarios que no existían en labels.ts/constants.ts (el catálogo no los edita allá).
// Textos tomados del formulario de contacto para que se lea igual en todo el CRM.
const INVESTMENT_PROFILE_LABELS: Record<string, string> = {
  END_USER: "Usuario final",
  INVESTOR_RENTAL: "Inversionista (renta)",
  INVESTOR_FLIP: "Inversionista (flip)",
  INVESTOR_LAND: "Inversionista (terreno)",
  MIXED: "Mixto",
};
const PURCHASE_TIMELINE_LABELS: Record<string, string> = {
  IMMEDIATE: "Inmediato",
  ONE_TO_THREE_MONTHS: "1-3 meses",
  THREE_TO_SIX_MONTHS: "3-6 meses",
  SIX_PLUS_MONTHS: "6+ meses",
};
const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CONTADO: "Contado",
  CREDITO_HIPOTECARIO: "Crédito hipotecario",
  FINANCIAMIENTO_DIRECTO: "Financiamiento directo",
  MIXTO: "Mixto",
};
const PURCHASE_MODALITY_LABELS: Record<string, string> = {
  PREVENTA: "Preventa",
  ENTREGA_INMEDIATA: "Entrega inmediata",
  REVENTA: "Reventa",
  ABIERTO: "Abierto",
};
const RENTAL_STRATEGY_LABELS: Record<string, string> = {
  LONG_TERM: "Largo plazo",
  AIRBNB: "Airbnb / corto plazo",
  BOTH: "Ambos",
  NA: "No aplica",
};

// Eventos que emite `emitEvent` (DomainEventType en events.ts + los que se emiten con literal
// en otros módulos). Un evento nuevo sin etiqueta se sigue pudiendo usar en modo Avanzado.
export const EVENTOS_DE_CONDICION: Record<string, string> = {
  "contact.created": "Contacto creado",
  "contact.lifecycle_changed": "Cambió la etapa del ciclo de vida",
  "contact.scored": "Cambió el score",
  "contact.merged": "Contactos fusionados",
  "contact.opted_out": "El contacto pidió no recibir mensajes",
  "lead.captured": "Lead capturado",
  "lead.assigned": "Lead asignado",
  "lead.reassigned": "Lead reasignado",
  "lead.orphaned": "Lead sin asesor disponible",
  "deal.created": "Negocio creado",
  "deal.stage_changed": "Negocio cambió de etapa",
  "deal.won": "Negocio ganado",
  "deal.lost": "Negocio perdido",
  "quote.opened": "Cotización abierta",
  "whatsapp.replied": "Respondió por WhatsApp",
  "social.replied": "Respondió por Instagram o Messenger",
  "payment.overdue": "Pago vencido",
  "visit.completed": "Visita realizada",
  "sla.breach": "Se venció el tiempo de respuesta (SLA)",
  "recruitment.apto": "Candidato apto",
  "recruitment.revisar": "Candidato por revisar",
  "recruitment.no_apto": "Candidato no apto",
};

const TODOS: ContextoDeCondicion[] = ["contact", "deal", "event"];
const DE_NEGOCIO: ContextoDeCondicion[] = ["deal", "event"];

// Los campos de contacto y anuncio se resuelven en cualquier contexto porque el motor
// siempre arma { contact, adAttribution, deal, event }.
export const CAMPOS_DE_CONDICION: CampoDeCondicion[] = [
  // Contacto
  { key: "contact.leadSource", label: "Fuente del lead", frase: "fuente", grupo: "Contacto", tipo: "enum", opciones: LEAD_SOURCE_LABELS, contextos: TODOS },
  { key: "contact.contactType", label: "Tipo de contacto", frase: "tipo de contacto", grupo: "Contacto", tipo: "enum", opciones: CONTACT_TYPE_LABELS, contextos: TODOS },
  { key: "contact.targetPlaza", label: "Plaza", frase: "plaza", grupo: "Contacto", tipo: "enum", opciones: PLAZA_LABELS, contextos: TODOS },
  { key: "contact.preferredZone", label: "Zona preferida", frase: "zona preferida", grupo: "Contacto", tipo: "text", contextos: TODOS },
  { key: "contact.preferredLanguage", label: "Idioma", frase: "idioma", grupo: "Contacto", tipo: "enum", opciones: PREFERRED_LANGUAGE_LABELS, contextos: TODOS },
  { key: "contact.residenceCountry", label: "País de residencia", frase: "país de residencia", grupo: "Contacto", tipo: "text", contextos: TODOS },
  { key: "contact.residenceCity", label: "Ciudad de residencia", frase: "ciudad de residencia", grupo: "Contacto", tipo: "text", contextos: TODOS },
  { key: "contact.nationality", label: "Nacionalidad", frase: "nacionalidad", grupo: "Contacto", tipo: "text", contextos: TODOS },
  // Perfil de inversión
  { key: "contact.budgetMin", label: "Presupuesto mín.", frase: "presupuesto mín.", grupo: "Perfil de inversión", tipo: "number", contextos: TODOS },
  { key: "contact.budgetMax", label: "Presupuesto máx.", frase: "presupuesto máx.", grupo: "Perfil de inversión", tipo: "number", contextos: TODOS },
  { key: "contact.propertyType", label: "Tipo de propiedad", frase: "tipo de propiedad", grupo: "Perfil de inversión", tipo: "enum", opciones: PROPERTY_TYPE_LABELS, contextos: TODOS },
  { key: "contact.purchaseTimeline", label: "Plazo de compra", frase: "plazo de compra", grupo: "Perfil de inversión", tipo: "enum", opciones: PURCHASE_TIMELINE_LABELS, contextos: TODOS },
  { key: "contact.paymentMethod", label: "Forma de pago", frase: "forma de pago", grupo: "Perfil de inversión", tipo: "enum", opciones: PAYMENT_METHOD_LABELS, contextos: TODOS },
  { key: "contact.investmentProfile", label: "Perfil de inversión", frase: "perfil de inversión", grupo: "Perfil de inversión", tipo: "enum", opciones: INVESTMENT_PROFILE_LABELS, contextos: TODOS },
  { key: "contact.purchaseModality", label: "Modalidad de compra", frase: "modalidad de compra", grupo: "Perfil de inversión", tipo: "enum", opciones: PURCHASE_MODALITY_LABELS, contextos: TODOS },
  { key: "contact.rentalStrategy", label: "Estrategia de renta", frase: "estrategia de renta", grupo: "Perfil de inversión", tipo: "enum", opciones: RENTAL_STRATEGY_LABELS, contextos: TODOS },
  // Calificación
  { key: "contact.score", label: "Score", frase: "score", grupo: "Calificación", tipo: "number", contextos: TODOS },
  { key: "contact.temperature", label: "Temperatura", frase: "temperatura", grupo: "Calificación", tipo: "enum", opciones: LEAD_TEMPERATURE_LABELS, contextos: TODOS },
  { key: "contact.contactStatus", label: "Estado del contacto", frase: "estado del contacto", grupo: "Calificación", tipo: "enum", opciones: CONTACT_STATUS_LABELS, contextos: TODOS },
  { key: "contact.lifecycleStage", label: "Etapa del ciclo de vida", frase: "etapa del ciclo de vida", grupo: "Calificación", tipo: "enum", opciones: LIFECYCLE_LABELS, contextos: TODOS },
  { key: "contact.urgency", label: "Urgencia", frase: "urgencia", grupo: "Calificación", tipo: "enum", opciones: URGENCY_LABELS, contextos: TODOS },
  { key: "contact.doNotContact", label: "No contactar", frase: "no contactar", grupo: "Calificación", tipo: "boolean", contextos: TODOS },
  { key: "contact.whatsappOptOut", label: "Pidió no recibir WhatsApp", frase: "pidió no recibir WhatsApp", grupo: "Calificación", tipo: "boolean", contextos: TODOS },
  { key: "contact.tags", label: "Etiquetas", frase: "etiquetas", grupo: "Calificación", tipo: "text", contextos: TODOS, ayuda: "Una etiqueta del contacto; se compara con «contiene»." },
  // Anuncio (Meta). `network` es texto libre en la BD (p. ej. "meta", "META_DM"): sin diccionario no hay enum.
  { key: "adAttribution.campaignName", label: "Campaña", frase: "campaña", grupo: "Anuncio (Meta)", tipo: "text", contextos: TODOS },
  { key: "adAttribution.adsetName", label: "Conjunto de anuncios", frase: "conjunto de anuncios", grupo: "Anuncio (Meta)", tipo: "text", contextos: TODOS },
  { key: "adAttribution.adName", label: "Anuncio", frase: "anuncio", grupo: "Anuncio (Meta)", tipo: "text", contextos: TODOS },
  { key: "adAttribution.network", label: "Red", frase: "red", grupo: "Anuncio (Meta)", tipo: "text", contextos: TODOS, ayuda: "Texto libre, p. ej. meta o META_DM." },
  // Negocio
  { key: "deal.stage", label: "Etapa del negocio", frase: "etapa del negocio", grupo: "Negocio", tipo: "enum", opciones: STAGE_LABELS, contextos: DE_NEGOCIO },
  { key: "deal.dealType", label: "Tipo de negocio", frase: "tipo de negocio", grupo: "Negocio", tipo: "enum", opciones: DEAL_TYPE_LABELS, contextos: DE_NEGOCIO },
  { key: "deal.estimatedValue", label: "Valor estimado", frase: "valor estimado", grupo: "Negocio", tipo: "number", contextos: DE_NEGOCIO },
  { key: "deal.currency", label: "Moneda", frase: "moneda", grupo: "Negocio", tipo: "enum", opciones: CURRENCY_LABELS, contextos: DE_NEGOCIO },
  { key: "deal.probability", label: "Probabilidad (%)", frase: "probabilidad", grupo: "Negocio", tipo: "number", contextos: DE_NEGOCIO },
  { key: "deal.lostReason", label: "Motivo de pérdida", frase: "motivo de pérdida", grupo: "Negocio", tipo: "enum", opciones: LOST_REASON_LABELS, contextos: DE_NEGOCIO },
  // Calculado por `loadEntityContext` (engine.ts): no es columna de Deal.
  { key: "deal.hasQuote", label: "Tiene cotización", frase: "tiene cotización", grupo: "Negocio", tipo: "boolean", contextos: DE_NEGOCIO, ayuda: "El negocio tiene cotización" },
  // Evento
  { key: "event.type", label: "Tipo de evento", frase: "evento", grupo: "Evento", tipo: "enum", opciones: EVENTOS_DE_CONDICION, contextos: ["event"] },
  // Contexto: no es una columna de BD; `buildContext` (engine.ts) lo calcula al evaluar. Solo existe
  // al procesar un evento: en las reglas de inactividad (scheduler.ts) `context` va vacío.
  { key: "context.isBusinessHours", label: "Es horario laboral", frase: "es horario laboral", grupo: "Contexto", tipo: "boolean", contextos: TODOS },
];

const POR_KEY = new Map(CAMPOS_DE_CONDICION.map((c) => [c.key, c]));

export function camposPara(contexto: ContextoDeCondicion): CampoDeCondicion[] {
  return CAMPOS_DE_CONDICION.filter((c) => c.contextos.includes(contexto));
}

export function campoPorKey(key: string): CampoDeCondicion | undefined {
  return POR_KEY.get(key);
}

/** Frase corta por campo ("fuente", "presupuesto máx."). */
export const FIELD_LABELS: Record<string, string> = Object.fromEntries(
  CAMPOS_DE_CONDICION.map((c) => [c.key, c.frase ?? c.label.charAt(0).toLowerCase() + c.label.slice(1)]),
);

/** Diccionario de valores por campo enum, para mostrar "Meta Ads" en vez de META_ADS. */
export const FIELD_VALUE_LABELS: Record<string, Record<string, string>> = Object.fromEntries(
  CAMPOS_DE_CONDICION.filter((c) => c.opciones).map((c) => [c.key, c.opciones as Record<string, string>]),
);

// ── Operadores ───────────────────────────────────────────────────────────────────────
const OP_ES = { value: "eq", label: "es" };
const OP_NEQ = { value: "neq", label: "no es" };
const OP_EXISTS = { value: "exists", label: "tiene valor" };
const OPERADORES: Record<TipoDeCampo, OperadorDeCondicion[]> = {
  enum: [
    OP_ES, OP_NEQ,
    { value: "in", label: "es alguno de" },
    { value: "nin", label: "no es ninguno de" },
    OP_EXISTS,
    { value: "changed_to", label: "cambió a" },
  ],
  number: [
    OP_ES, OP_NEQ,
    { value: "gt", label: "mayor que" },
    { value: "gte", label: "al menos" },
    { value: "lt", label: "menor que" },
    { value: "lte", label: "como máximo" },
    OP_EXISTS,
  ],
  text: [OP_ES, OP_NEQ, { value: "contains", label: "contiene" }, OP_EXISTS],
  boolean: [OP_ES],
};

export function operadoresPara(tipo: TipoDeCampo): OperadorDeCondicion[] {
  return OPERADORES[tipo].map((o) => ({ ...o }));
}

export function operadorExigeValor(op: string): boolean {
  return op !== "exists";
}

// Cómo se lee cada operador dentro de una frase ("presupuesto máx. es al menos 250,000").
const OP_FRASE: Record<string, string> = {
  eq: "es", neq: "no es", gt: "es mayor que", gte: "es al menos", lt: "es menor que",
  lte: "es como máximo", in: "es alguno de", nin: "no es ninguno de", contains: "contiene",
  exists: "tiene valor", changed_to: "cambió a",
};

// ── Conversión UI ⇄ DSL ──────────────────────────────────────────────────────────────
const ES_NUMERO = /^-?\d+(\.\d+)?$/;

/** Lo que edita la UI → el `value` que guarda el DSL (array para in/nin, number, boolean, string). */
export function valorParaGuardar(
  campo: CampoDeCondicion | undefined,
  op: string,
  raw: string | string[] | boolean | number,
): unknown {
  if (op === "exists") return true;
  if (op === "in" || op === "nin") {
    const lista = Array.isArray(raw) ? raw : String(raw).split(",");
    const limpia = lista.map((s) => String(s).trim()).filter(Boolean);
    // En campos numéricos el evaluador compara con === contra un number.
    return campo?.tipo === "number" ? limpia.map((s) => (ES_NUMERO.test(s) ? Number(s) : s)) : limpia;
  }
  if (campo?.tipo === "boolean") return raw === true || String(raw).trim().toLowerCase() === "true";
  if (typeof raw === "boolean" || typeof raw === "number") return raw;
  const texto = Array.isArray(raw) ? raw.join(",") : raw;
  // gt/gte/lt/lte exigen number en el evaluador. Si no es numérico se devuelve el texto tal cual
  // para que validarCondiciones lo marque en vez de guardar un NaN.
  if (campo?.tipo === "number") return ES_NUMERO.test(texto.trim()) ? Number(texto.trim()) : texto.trim();
  // Campo fuera del catálogo: misma regla que parseValue del builder (números como number).
  if (!campo && ES_NUMERO.test(texto.trim())) return Number(texto.trim());
  return campo ? texto.trim() : texto;
}

/** `value` del DSL → forma editable (string[] para in/nin, boolean para booleanos, string para el resto). */
export function valorDesdeDsl(campo: CampoDeCondicion | undefined, op: string, value: unknown): ValorEditable {
  if (op === "exists") return "";
  if (op === "in" || op === "nin") {
    if (Array.isArray(value)) return value.map(String);
    return value == null || value === "" ? [] : [String(value)];
  }
  if (campo?.tipo === "boolean") return value === true || value === "true";
  if (Array.isArray(value)) return value.map(String).join(",");
  return value == null ? "" : String(value);
}

// ── Lectura en español ───────────────────────────────────────────────────────────────
const FORMATO_NUMERO = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 2 });

function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field.replace(/^contact\./, "");
}

export function valueLabel(field: string, value: unknown): string {
  const campo = campoPorKey(field);
  const uno = (v: unknown): string => {
    if (typeof v === "boolean") return v ? "Sí" : "No";
    if (typeof v === "number") return FORMATO_NUMERO.format(v);
    if (typeof v === "string") {
      if (campo?.opciones) return etiqueta(campo.opciones, v);
      if (campo?.tipo === "number" && ES_NUMERO.test(v.trim())) return FORMATO_NUMERO.format(Number(v));
      return v;
    }
    return String(v);
  };
  if (Array.isArray(value)) return value.map(uno).join(", ");
  if (value == null) return "";
  return uno(value);
}

/** Resumen legible del DSL de condiciones. Sin condiciones → "siempre" (o `opts.vacio`). */
export function describeConditions(conditions: unknown, opts: { vacio?: string } = {}): string {
  const vacio = opts.vacio ?? "siempre";
  const texto = (c: unknown): string | null => {
    if (!c || typeof c !== "object") return null;
    const node = c as Record<string, unknown>;
    if (Array.isArray(node.all)) {
      const partes = node.all.map(texto).filter((p): p is string => !!p);
      return partes.length ? partes.join(" y ") : null;
    }
    if (Array.isArray(node.any)) {
      const partes = node.any.map(texto).filter((p): p is string => !!p);
      return partes.length ? `(${partes.join(" o ")})` : null;
    }
    if (typeof node.field === "string" && typeof node.op === "string") {
      const base = `${fieldLabel(node.field)} ${OP_FRASE[node.op] ?? node.op}`;
      return node.op === "exists" ? base : `${base} ${valueLabel(node.field, node.value)}`.trim();
    }
    return null;
  };
  return texto(conditions) ?? vacio;
}

// ── Validación previa a guardar ──────────────────────────────────────────────────────
function valorVacio(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function validarHoja(node: Record<string, unknown>, problemas: string[]): void {
  const field = typeof node.field === "string" ? node.field.trim() : "";
  const op = typeof node.op === "string" ? node.op : "";
  if (!field) { problemas.push("Falta elegir el dato de una condición"); return; }
  const campo = campoPorKey(field);
  const nombre = campo ? campo.label : fieldLabel(field);
  if (!op) { problemas.push(`${nombre}: falta elegir el operador`); return; }
  const aplica = !campo || OPERADORES[campo.tipo].some((o) => o.value === op);
  if (!aplica) { problemas.push(`${nombre}: el operador no aplica a este dato`); return; }
  if (!operadorExigeValor(op)) return;
  if (valorVacio(node.value)) { problemas.push(`${nombre}: falta el valor`); return; }
  // Campos fuera del catálogo (p. ej. contact.custom.*): solo se valida que no esté vacío.
  if (!campo) return;
  const value = node.value;
  if (op === "in" || op === "nin") {
    if (!Array.isArray(value)) problemas.push(`${nombre}: el valor debe ser una lista`);
    return;
  }
  if (campo.tipo === "number") {
    // gt/gte/lt/lte exigen number; eq/neq también, porque se comparan con ===.
    if (typeof value !== "number" || !Number.isFinite(value)) problemas.push(`${nombre}: el valor debe ser un número`);
  } else if (campo.tipo === "boolean") {
    // La fila plana del builder entrega "true"/"false" como texto; el DSL guarda boolean.
    if (typeof value !== "boolean" && value !== "true" && value !== "false") problemas.push(`${nombre}: el valor debe ser Sí o No`);
  }
}

/** Revisa un DSL de condiciones antes de guardarlo. Árbol vacío → ok. */
export function validarCondiciones(conditions: unknown): ResultadoValidacion {
  const problemas: string[] = [];
  const recorrer = (c: unknown) => {
    if (!c || typeof c !== "object") return;
    const node = c as Record<string, unknown>;
    if (Array.isArray(node.all)) node.all.forEach(recorrer);
    else if (Array.isArray(node.any)) node.any.forEach(recorrer);
    else if ("field" in node || "op" in node) validarHoja(node, problemas);
  };
  recorrer(conditions);
  return { ok: problemas.length === 0, problemas };
}
