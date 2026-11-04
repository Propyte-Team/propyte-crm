// Catálogo de acciones en español + lectura de reglas y cadencias en frase (E3, tarjeta 964).
// Puro: sin React ni BD.
//
// Por qué existe: una regla se lee "Cuando entra un lead · si fuente es … · entonces asignar
// asesor → el bot responde → avisar al asesor". Este catálogo dice, por cada acción que el
// motor ejecuta (`executeAction` en actions.ts), qué campos lee DE VERDAD, cómo se llaman en
// español, de dónde salen sus valores (listas, no teclear claves) y cómo se lee en una frase.
// Lo GUARDADO no cambia: `AutomationRule.actions` (ActionSpec/WorkflowNode) y
// `ActionPlanStep` (actionType/config/delayMinutes). Solo se cambia cómo se arma y cómo se lee.
// Etiqueta y grupo de cada acción salen de node-catalog.ts (NODE_CATALOG, sin el emoji) para no
// tener dos textos distintos para lo mismo; los campos y frases son de este archivo.
//
// ── API (todo exportado de este archivo) ─────────────────────────────────────────────
// Tipos
//   FuentesDeAccion    { plantillas?: Record<idOClave,nombre>; cadencias?: Record<id,nombre>;
//                        usuarios?: Record<id,nombre> }   (forma de `GET /api/admin/automation/fuentes`
//                        convertida a mapas con `fuentesDesdeRespuesta`). Un mapa AUSENTE = "no
//                        cargado": no se valida contra él y se muestra la clave humanizada.
//   FuenteDeCampo      "plantillas_whatsapp" | "plantillas_email" | "cadencias" | "usuarios" | "roles"
//                      | "etapas" | "ciclo" | "campos_contacto" | "tipos_aviso"
//                      (`usuarios` y `roles` están en el tipo por el spec pero ninguna acción los usa:
//                       el motor no lee destinatarios, ver "ESCALATE/NOTIFY" abajo).
//   TipoDeCampoDeAccion "text" | "textarea" | "number" | "select" | "fuente" | "checkbox"
//   CampoDeAccion      { key, label, kind, fuente?, opciones?, permiteOtro?, dependeDe?, opcionesPorValor?,
//                        unidad?, placeholder?, ayuda?, requerido? }
//       kind "fuente"   → las opciones vienen de la API (`fuente` dice cuál: plantillas_*, cadencias).
//       kind "select"   → las opciones son estáticas: `opciones` (value → etiqueta) o, si `dependeDe`
//                         está, `opcionesPorValor[config[dependeDe]]` (UPDATE_FIELD.value según `field`).
//                         `fuente` también se informa ("etapas", "ciclo", …) solo como documentación.
//       permiteOtro     → el motor acepta texto libre (AI goal, NOTIFY.type): la UI debe mostrar un
//                         valor guardado que no esté en `opciones` en vez de borrarlo.
//       checkbox        → boolean (extensión del spec: SET_LIFECYCLE.allowBackward).
//       unidad "min"    → `number` guardado en minutos (dueInMinutes): la UI puede mostrar DelayInput.
//   GrupoDeAccion      "Comunicación" | "Pipeline" | "Asignación" | "IA" | "Otros"  (= NodeCategory)
//   AccionDeCatalogo   { type, label, icono (nombre de lucide-react), grupo, frase(config, fuentes?),
//                        campos, estado: "activo" | "proximamente", ayuda? }
//   AccionLike         { type, config?, delayMinutes?, kind?, branches? }   (un nodo de `actions`)
//   PasoLike           { actionType, config?, delayMinutes? }               (un ActionPlanStep)
//   ReglaLike          { triggerType, triggerConfig?, conditions?, actions? }
// Datos
//   ACCIONES: AccionDeCatalogo[]          (orden de presentación; agrupar por `grupo`)
//   GRUPOS_DE_ACCION: GrupoDeAccion[]
// Funciones
//   accionPorTipo(type): AccionDeCatalogo | undefined
//   camposVisibles(type, config): CampoDeAccion[]    campos de la acción (hoy = todos; punto único si luego se ocultan)
//   opcionesDeCampo(campo, config): Record<string,string> | undefined   opciones estáticas ya resueltas
//   configParaGuardar(type, raw): Record<string, unknown>
//       Convierte lo que edita la UI (todo texto) a lo que lee el motor: number para kind number,
//       boolean para checkbox, quita vacíos y CONSERVA las claves que el catálogo no conoce
//       (p. ej. `strategy`, `mode`, `to`, `useMatching`: no se pierden al editar).
//   describirRetraso(minutos): string                "de inmediato" | "tras 15 min" | "tras 2 días"
//   describeAction(action, fuentes?, opts?: { conRetraso?: boolean }): string
//       "enviar WhatsApp «Bienvenida postventa»". `conRetraso` agrega " (tras 1 día)" con el
//       `delayMinutes` de primer nivel o, si no hay, `config.delayMinutes` (ambos los lee el motor).
//   describeActions(actions, fuentes?, opts?): string    frases unidas con " → " ("" si no hay)
//   describeRule(rule, fuentes?): string
//       "Cuando … · si … · entonces …"; sin condiciones se omite el "si".
//   describeStep(step, fuentes?, opts?: { acumuladoMinutos?: number }): string
//       "Día 2: enviar WhatsApp «Seguimiento»" (con acumulado) o "Tras 1 día: …" (relativo).
//   validarAccion(action, fuentes?): ResultadoValidacion   { ok, problemas } (campo requerido vacío,
//       plantilla/cadencia inexistente si hay fuentes, valores fuera de lista que el motor descarta)
//   fuentesDesdeRespuesta(data): FuentesDeAccion     { plantillas:[{id,nombre,…}], … } → mapas
import { CONTACT_TYPE_ORDER, LEAD_SOURCE_ORDER, STAGE_LABELS, LIFECYCLE_LABELS } from "@/lib/constants";
import { metaFor, type NodeCategory } from "@/lib/journey/node-catalog";
import {
  describeConditions, campoPorKey, FIELD_LABELS, FIELD_VALUE_LABELS, type ResultadoValidacion,
} from "./condition-catalog";
import { describeTrigger } from "./trigger-catalog";

// ── Tipos ────────────────────────────────────────────────────────────────────────────
export interface FuentesDeAccion {
  plantillas?: Record<string, string>;
  cadencias?: Record<string, string>;
  usuarios?: Record<string, string>;
}
export type FuenteDeCampo =
  | "plantillas_whatsapp" | "plantillas_email" | "cadencias" | "usuarios" | "roles"
  | "etapas" | "ciclo" | "campos_contacto" | "tipos_aviso";
export type TipoDeCampoDeAccion = "text" | "textarea" | "number" | "select" | "fuente" | "checkbox";
export type GrupoDeAccion = NodeCategory;

export interface CampoDeAccion {
  key: string;
  label: string;
  kind: TipoDeCampoDeAccion;
  fuente?: FuenteDeCampo;
  opciones?: Record<string, string>;
  permiteOtro?: boolean;
  dependeDe?: string;
  opcionesPorValor?: Record<string, Record<string, string>>;
  unidad?: string;
  placeholder?: string;
  ayuda?: string;
  requerido?: boolean;
}

type Config = Record<string, unknown>;

export interface AccionDeCatalogo {
  type: string;
  label: string;
  icono: string;
  grupo: GrupoDeAccion;
  frase: (config: Config, fuentes?: FuentesDeAccion) => string;
  campos: CampoDeAccion[];
  estado: "activo" | "proximamente";
  ayuda?: string;
}

export interface AccionLike { type: string; config?: Config | null; delayMinutes?: number | null; kind?: string; branches?: unknown }
export interface PasoLike { actionType: string; config?: Config | null; delayMinutes?: number | null }
export interface ReglaLike { triggerType: string; triggerConfig?: unknown; conditions?: unknown; actions?: unknown }

export const GRUPOS_DE_ACCION: GrupoDeAccion[] = ["Comunicación", "Pipeline", "Asignación", "IA", "Otros"];

// ── Utilidades de texto ──────────────────────────────────────────────────────────────
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "bienvenida_postventa" → "Bienvenida postventa". Sin dependencias: labels.humanizar no se exporta. */
function humanizar(raw: string): string {
  const t = raw.replace(/[._-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim().toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function texto(v: unknown): string {
  return typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
}

/** Nombre de una referencia (id o clave) con las fuentes; sin fuentes o si no está, la clave humanizada. */
function nombreDe(mapa: Record<string, string> | undefined, ref: string, vacio: string): string {
  if (mapa && Object.prototype.hasOwnProperty.call(mapa, ref)) return mapa[ref];
  return UUID.test(ref) ? vacio : humanizar(ref);
}

const FORMATO_NUMERO = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 2 });

/** Duración exacta en la unidad más grande que la divide: 1440 → "1 día", 90 → "90 min". */
function duracion(minutos: number): string {
  if (minutos % 1440 === 0) return `${minutos / 1440} ${minutos / 1440 === 1 ? "día" : "días"}`;
  if (minutos % 60 === 0) return `${minutos / 60} h`;
  return `${FORMATO_NUMERO.format(minutos)} min`;
}

export function describirRetraso(minutos: number | null | undefined): string {
  return typeof minutos === "number" && minutos > 0 ? `tras ${duracion(minutos)}` : "de inmediato";
}

// ── Opciones estáticas ───────────────────────────────────────────────────────────────
const soloVigentes = (dic: Record<string, string> | undefined, orden: readonly string[]) =>
  Object.fromEntries(orden.filter((k) => dic?.[k]).map((k) => [k, dic![k]]));

// UPDATE_FIELD: lista blanca del motor (actions.ts). contactType/leadSource además validan contra
// CONTACT_TYPE_ORDER/LEAD_SOURCE_ORDER: los valores retirados (REFERIDOR, REFERIDO_BROKER) no se ofrecen.
const CAMPOS_ACTUALIZABLES = ["temperature", "contactStatus", "urgency", "contactType", "leadSource"] as const;
const OPCIONES_CAMPO: Record<string, Record<string, string>> = {
  temperature: FIELD_VALUE_LABELS["contact.temperature"] ?? {},
  contactStatus: FIELD_VALUE_LABELS["contact.contactStatus"] ?? {},
  urgency: FIELD_VALUE_LABELS["contact.urgency"] ?? {},
  contactType: soloVigentes(FIELD_VALUE_LABELS["contact.contactType"], CONTACT_TYPE_ORDER),
  leadSource: soloVigentes(FIELD_VALUE_LABELS["contact.leadSource"], LEAD_SOURCE_ORDER),
};
const CAMPOS_ACTUALIZABLES_OPCIONES: Record<string, string> = Object.fromEntries(
  CAMPOS_ACTUALIZABLES.map((k) => [k, campoPorKey(`contact.${k}`)?.label ?? humanizar(k)]),
);

// Tipos de aviso que el CRM crea (actions.ts / ai-actions.ts / sla.ts). El motor acepta cualquier texto.
const TIPOS_DE_AVISO: Record<string, string> = {
  workflow: "Aviso general",
  escalation: "Escalamiento",
  call_task: "Llamada pendiente",
  ai_draft: "Borrador de IA listo",
  sla_breach: "Tiempo de respuesta vencido",
};

// `goal` de AI_REPLY se inyecta TAL CUAL en el prompt del bot ("El objetivo de este mensaje es: …",
// bot-respond.ts), no es un enum cerrado: estos son los valores que usan las reglas canónicas y
// los tests. AI_DRAFT lee `kind ?? goal` (ai-actions.ts) con los mismos valores.
const OBJETIVOS_IA: Record<string, string> = {
  saludo_calificacion: "saludo y calificación",
  seguimiento: "seguimiento",
  reactivacion: "reactivación",
  quote_followup: "seguimiento de cotización",
};

const objetivoLegible = (v: string) => OBJETIVOS_IA[v] ?? v.replace(/[_-]+/g, " ").trim().toLowerCase();

// ── Frases por acción ────────────────────────────────────────────────────────────────
const entre = (s: string) => `«${s}»`;

function hostDe(url: string): string {
  try { return new URL(url).host; } catch { return ""; }
}

const FRASE: Record<string, (c: Config, f?: FuentesDeAccion) => string> = {
  SEND_WHATSAPP: (c, f) => {
    const t = texto(c.template);
    if (t) return `enviar WhatsApp ${entre(nombreDe(f?.plantillas, t, "una plantilla"))}`;
    return texto(c.body) ? "enviar un WhatsApp con mensaje propio" : "enviar un WhatsApp";
  },
  SEND_EMAIL: (c, f) => {
    const t = texto(c.template);
    if (t) return `enviar correo ${entre(nombreDe(f?.plantillas, t, "una plantilla"))}`;
    return texto(c.subject) ? `enviar correo ${entre(texto(c.subject))}` : "enviar un correo";
  },
  // `to` de NOTIFY no lo lee el motor (el aviso va al asesor del contacto, o a un mando si no hay);
  // `template` se usa como TEXTO del aviso, no como plantilla: no se muestra como nombre.
  NOTIFY: (c) => (texto(c.title) ? `avisar al asesor: ${entre(texto(c.title))}` : "avisar al asesor"),
  CREATE_TASK: (c) => {
    const base = texto(c.subject) ? `crear la tarea ${entre(texto(c.subject))}` : "crear una tarea";
    return typeof c.dueInMinutes === "number" && c.dueInMinutes > 0 ? `${base} (vence en ${duracion(c.dueInMinutes)})` : base;
  },
  // MAKE_CALL no marca: crea una tarea de llamada + aviso para el asesor (actions.ts).
  MAKE_CALL: (c) => (texto(c.subject) ? `crear la tarea de llamada ${entre(texto(c.subject))}` : "crear una tarea de llamada"),
  ASSIGN: () => "asignar asesor",
  REASSIGN: () => "reasignar asesor",
  ENROLL_PLAN: (c, f) => {
    const id = texto(c.planId);
    if (!id) return "inscribir en una cadencia";
    const nombre = f?.cadencias && Object.prototype.hasOwnProperty.call(f.cadencias, id) ? f.cadencias[id] : null;
    if (nombre) return `inscribir en la cadencia ${entre(nombre)}`;
    return f?.cadencias ? "inscribir en una cadencia que ya no existe" : "inscribir en una cadencia";
  },
  CHANGE_STAGE: (c) => {
    const s = texto(c.toStage);
    return s ? `mover el negocio a ${entre(STAGE_LABELS[s] ?? humanizar(s))}` : "mover el negocio de etapa";
  },
  SET_LIFECYCLE: (c) => {
    const s = texto(c.toStage);
    const base = s ? `pasar el contacto a ${entre(LIFECYCLE_LABELS[s] ?? humanizar(s))}` : "cambiar el ciclo de vida del contacto";
    return c.allowBackward === true ? `${base} (aunque retroceda)` : base;
  },
  ADD_TAG: (c) => (texto(c.tag) ? `agregar la etiqueta ${entre(texto(c.tag))}` : "agregar una etiqueta"),
  UPDATE_FIELD: (c) => {
    const campo = texto(c.field);
    if (!campo) return "cambiar un dato del contacto";
    const nombre = FIELD_LABELS[`contact.${campo}`] ?? humanizar(campo).toLowerCase();
    const v = texto(c.value);
    if (!v) return `cambiar ${nombre}`;
    return `cambiar ${nombre} a ${entre(OPCIONES_CAMPO[campo]?.[v] ?? FIELD_VALUE_LABELS[`contact.${campo}`]?.[v] ?? v)}`;
  },
  // `to` de ESCALATE solo se imprime en el texto del aviso: el motor siempre escala al líder
  // de equipo del asesor y, si no hay, a Gerencia/Dirección/Admin (actions.ts). No es un rol elegible.
  ESCALATE: (c) => (texto(c.reason) ? `escalar al líder o a la gerencia: ${entre(texto(c.reason))}` : "escalar al líder o a la gerencia"),
  AI_REPLY: (c) => (texto(c.goal) ? `el bot responde (${objetivoLegible(texto(c.goal))})` : "el bot responde"),
  AI_DRAFT: (c) => {
    const k = texto(c.kind) || texto(c.goal);
    return k ? `preparar un borrador con IA (${objetivoLegible(k)})` : "preparar un borrador con IA";
  },
  AI_CALL_SUMMARY: () => "resumir la llamada con IA",
  WEBHOOK: (c) => {
    const host = hostDe(texto(c.url));
    return host ? `avisar a un servicio externo (${host})` : "avisar a un servicio externo";
  },
};

// ── Campos por acción ────────────────────────────────────────────────────────────────
const CAMPOS: Record<string, CampoDeAccion[]> = {
  SEND_WHATSAPP: [
    { key: "template", label: "Plantilla de WhatsApp", kind: "fuente", fuente: "plantillas_whatsapp", ayuda: "Se envía en el idioma del contacto; si no hay plantilla en ese idioma, no se envía." },
    { key: "body", label: "Mensaje propio", kind: "textarea", ayuda: "Solo se usa si no eliges plantilla." },
  ],
  SEND_EMAIL: [
    { key: "template", label: "Plantilla de correo", kind: "fuente", fuente: "plantillas_email", ayuda: "Con plantilla se usan su asunto y su cuerpo." },
    { key: "subject", label: "Asunto", kind: "text", ayuda: "Solo sin plantilla." },
    { key: "body", label: "Cuerpo", kind: "textarea", ayuda: "Solo sin plantilla." },
  ],
  NOTIFY: [
    { key: "title", label: "Título", kind: "text", placeholder: "Aviso de flujo" },
    { key: "message", label: "Mensaje", kind: "textarea" },
    { key: "type", label: "Tipo de aviso", kind: "select", fuente: "tipos_aviso", opciones: TIPOS_DE_AVISO, permiteOtro: true },
  ],
  CREATE_TASK: [
    { key: "subject", label: "Asunto", kind: "text", placeholder: "Tarea de workflow" },
    { key: "description", label: "Descripción", kind: "textarea" },
    { key: "dueInMinutes", label: "Vence en", kind: "number", unidad: "min", placeholder: "1440", ayuda: "Sin valor vence en 1 día." },
  ],
  MAKE_CALL: [
    { key: "subject", label: "Asunto", kind: "text", ayuda: "Sin valor: «Llamar a {nombre}»." },
    { key: "reason", label: "Nota para el asesor", kind: "text" },
    { key: "dueInMinutes", label: "Vence en", kind: "number", unidad: "min", placeholder: "60", ayuda: "Sin valor vence en 1 hora." },
  ],
  ASSIGN: [{ key: "reason", label: "Motivo", kind: "text", ayuda: "Queda en el historial del reparto." }],
  REASSIGN: [{ key: "reason", label: "Motivo", kind: "text", ayuda: "Queda en el historial del reparto." }],
  ESCALATE: [{ key: "reason", label: "Motivo", kind: "text", ayuda: "Va en el aviso al líder o a la gerencia." }],
  UPDATE_FIELD: [
    { key: "field", label: "Dato a cambiar", kind: "select", fuente: "campos_contacto", opciones: CAMPOS_ACTUALIZABLES_OPCIONES, requerido: true },
    { key: "value", label: "Nuevo valor", kind: "select", dependeDe: "field", opcionesPorValor: OPCIONES_CAMPO, requerido: true },
  ],
  ADD_TAG: [{ key: "tag", label: "Etiqueta", kind: "text", requerido: true }],
  CHANGE_STAGE: [
    { key: "toStage", label: "Etapa del negocio", kind: "select", fuente: "etapas", opciones: STAGE_LABELS, requerido: true, ayuda: "Solo aplica a negocios." },
  ],
  SET_LIFECYCLE: [
    { key: "toStage", label: "Etapa del ciclo de vida", kind: "select", fuente: "ciclo", opciones: LIFECYCLE_LABELS, requerido: true },
    { key: "allowBackward", label: "Permitir retroceso", kind: "checkbox", ayuda: "Sin marcar, solo avanza." },
  ],
  ENROLL_PLAN: [{ key: "planId", label: "Cadencia", kind: "fuente", fuente: "cadencias", requerido: true, ayuda: "La cadencia debe estar activa." }],
  AI_REPLY: [
    { key: "goal", label: "Objetivo del bot", kind: "select", opciones: OBJETIVOS_IA, permiteOtro: true, ayuda: "Solo responde si la conversación sigue con el bot." },
  ],
  AI_DRAFT: [
    { key: "kind", label: "Tipo de borrador", kind: "select", opciones: OBJETIVOS_IA, permiteOtro: true, ayuda: "Requiere que el contacto tenga asesor." },
  ],
  AI_CALL_SUMMARY: [],
  WEBHOOK: [{ key: "url", label: "Dirección (https)", kind: "text", requerido: true, placeholder: "https://" }],
};

const ICONOS: Record<string, string> = {
  SEND_WHATSAPP: "MessageCircle", SEND_EMAIL: "Mail", NOTIFY: "Bell", CREATE_TASK: "ClipboardList",
  MAKE_CALL: "Phone", ASSIGN: "UserPlus", REASSIGN: "Shuffle", ESCALATE: "TriangleAlert",
  UPDATE_FIELD: "Pencil", ADD_TAG: "Tag", CHANGE_STAGE: "Flag", SET_LIFECYCLE: "RefreshCw",
  ENROLL_PLAN: "Repeat", AI_REPLY: "Bot", AI_DRAFT: "Sparkles", AI_CALL_SUMMARY: "PhoneCall", WEBHOOK: "Link",
};

// Ayudas que explican un comportamiento del motor que sorprendería a quien arma la regla.
const AYUDAS: Record<string, string> = {
  ASSIGN: "Si el contacto ya tiene asesor, no hace nada.",
  REASSIGN: "Vuelve a repartir el contacto entre los asesores.",
  MAKE_CALL: "No marca: crea una tarea de llamada y avisa al asesor.",
  AI_CALL_SUMMARY: "El resumen de llamadas llega con la fase de voz: hoy la acción se omite.",
  WEBHOOK: "Envía el contacto a una dirección https.",
};

const ORDEN: string[] = [
  "SEND_WHATSAPP", "SEND_EMAIL", "NOTIFY", "MAKE_CALL",
  "CHANGE_STAGE", "SET_LIFECYCLE", "ADD_TAG", "UPDATE_FIELD",
  "ASSIGN", "REASSIGN", "ESCALATE",
  "AI_REPLY", "AI_DRAFT", "AI_CALL_SUMMARY",
  "CREATE_TASK", "ENROLL_PLAN", "WEBHOOK",
];

// Etiqueta de node-catalog sin el emoji inicial ("💬 WhatsApp" → "WhatsApp").
const sinEmoji = (s: string) => s.replace(/^[^\p{L}\p{N}]+/u, "").trim();

export const ACCIONES: AccionDeCatalogo[] = ORDEN.map((type) => {
  const meta = metaFor(type);
  return {
    type,
    label: sinEmoji(meta?.label ?? humanizar(type)),
    icono: ICONOS[type] ?? "Circle",
    grupo: meta?.category ?? "Otros",
    frase: FRASE[type],
    campos: CAMPOS[type] ?? [],
    // actions.ts ejecuta todas; la única que se omite siempre es AI_CALL_SUMMARY (ai-actions.ts).
    estado: type === "AI_CALL_SUMMARY" ? "proximamente" : "activo",
    ...(AYUDAS[type] ? { ayuda: AYUDAS[type] } : {}),
  };
});

const POR_TIPO = new Map(ACCIONES.map((a) => [a.type, a]));

export function accionPorTipo(type: string): AccionDeCatalogo | undefined {
  return POR_TIPO.get(type);
}

export function camposVisibles(type: string, _config: Config = {}): CampoDeAccion[] {
  return accionPorTipo(type)?.campos ?? [];
}

/** Opciones estáticas de un campo ya resueltas (considera `dependeDe`). undefined = campo libre o de fuente. */
export function opcionesDeCampo(campo: CampoDeAccion, config: Config = {}): Record<string, string> | undefined {
  if (campo.dependeDe) return campo.opcionesPorValor?.[texto(config[campo.dependeDe])];
  return campo.opciones;
}

// ── UI → guardado ────────────────────────────────────────────────────────────────────
const ES_NUMERO = /^-?\d+(\.\d+)?$/;

export function configParaGuardar(type: string, raw: Config): Config {
  const out: Config = { ...raw };
  for (const campo of camposVisibles(type)) {
    const v = raw[campo.key];
    if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) {
      delete out[campo.key];
      continue;
    }
    if (campo.kind === "number") {
      // actions.ts exige `typeof === "number"`. Si no es numérico se deja el texto para que validarAccion lo marque.
      out[campo.key] = typeof v === "string" && ES_NUMERO.test(v.trim()) ? Number(v.trim()) : v;
    } else if (campo.kind === "checkbox") {
      // El motor compara `allowBackward === true`: un "false" en texto debe volverse false, no quedar truthy.
      out[campo.key] = v === true || v === "true";
    } else if (typeof v === "string") {
      out[campo.key] = v.trim();
    }
  }
  return out;
}

// ── Lectura en español ───────────────────────────────────────────────────────────────
function esDecision(a: unknown): boolean {
  return !!a && typeof a === "object" && (a as { kind?: unknown }).kind === "decision";
}

export function describeAction(
  action: AccionLike,
  fuentes?: FuentesDeAccion,
  opts: { conRetraso?: boolean } = {},
): string {
  if (esDecision(action)) {
    const n = Array.isArray(action.branches) ? action.branches.length : 0;
    return n > 0 ? `decidir según condiciones (${n} ${n === 1 ? "rama" : "ramas"})` : "decidir según condiciones";
  }
  const def = accionPorTipo(action.type);
  const config = (action.config ?? {}) as Config;
  const frase = def ? def.frase(config, fuentes) : humanizar(action.type).toLowerCase();
  // Primer nivel, o `config.delayMinutes` (como lo guarda el seed y lo lee el motor).
  const minutos = action.delayMinutes ?? (typeof config.delayMinutes === "number" ? config.delayMinutes : undefined);
  const retraso = typeof minutos === "number" && minutos > 0;
  return opts.conRetraso && retraso ? `${frase} (${describirRetraso(minutos)})` : frase;
}

export function describeActions(
  actions: unknown,
  fuentes?: FuentesDeAccion,
  opts: { conRetraso?: boolean } = {},
): string {
  if (!Array.isArray(actions)) return "";
  return actions
    .filter((a): a is AccionLike => !!a && typeof a === "object")
    .map((a) => describeAction(a, fuentes, opts))
    .join(" → ");
}

export function describeRule(rule: ReglaLike, fuentes?: FuentesDeAccion): string {
  const partes = [`Cuando ${describeTrigger(rule.triggerType, rule.triggerConfig)}`];
  // vacio:"" → sin condiciones no se escribe el "si".
  const si = describeConditions(rule.conditions, { vacio: "" });
  if (si) partes.push(`si ${si}`);
  const entonces = describeActions(rule.actions, fuentes, { conRetraso: true });
  partes.push(`entonces ${entonces || "no hace nada"}`);
  return partes.join(" · ");
}

export function describeStep(
  step: PasoLike,
  fuentes?: FuentesDeAccion,
  opts: { acumuladoMinutos?: number } = {},
): string {
  const frase = describeAction({ type: step.actionType, config: step.config }, fuentes);
  const acum = opts.acumuladoMinutos;
  let cuando: string;
  if (typeof acum === "number") {
    if (acum <= 0) cuando = "Día 1";
    else if (acum % 1440 === 0) cuando = `Día ${acum / 1440 + 1}`;
    else cuando = `Tras ${duracion(acum)}`;
  } else {
    const d = step.delayMinutes;
    cuando = typeof d === "number" && d > 0 ? `Tras ${duracion(d)}` : "Al inscribir";
  }
  return `${cuando}: ${frase}`;
}

// ── Validación ───────────────────────────────────────────────────────────────────────
export function validarAccion(action: AccionLike, fuentes?: FuentesDeAccion): ResultadoValidacion {
  const problemas: string[] = [];
  const def = accionPorTipo(action.type);
  if (!def) return { ok: false, problemas: [`Acción desconocida: ${action.type}`] };
  const c = (action.config ?? {}) as Config;
  const nombre = def.label;
  const falta = (campo: string) => problemas.push(`${nombre}: falta ${campo}`);

  const retrasoAccion = action.delayMinutes ?? (c.delayMinutes as number | null | undefined);
  if (retrasoAccion != null && (!Number.isInteger(retrasoAccion) || retrasoAccion < 0)) {
    problemas.push(`${nombre}: el retraso debe ser un número entero de minutos, 0 o más`);
  }

  // Plantilla que no existe: actions.ts la busca por id o nombre (activa, no borrada, en el idioma
  // del contacto) y, si no la halla, omite el envío con "Sin plantilla ni body". Solo se valida si
  // las fuentes están cargadas.
  const plantilla = texto(c.template);
  const plantillaExiste = !plantilla || !fuentes?.plantillas || Object.prototype.hasOwnProperty.call(fuentes.plantillas, plantilla);

  switch (action.type) {
    case "SEND_WHATSAPP":
      if (!plantilla && !texto(c.body)) falta("elegir una plantilla o escribir el mensaje");
      else if (!plantillaExiste) problemas.push(`${nombre}: la plantilla «${humanizar(plantilla)}» no existe o está desactivada`);
      break;
    case "SEND_EMAIL":
      // Con plantilla el asunto y el cuerpo salen de ella; sin plantilla hacen falta los dos (resolveEmailContent).
      if (!plantilla && (!texto(c.subject) || !texto(c.body))) falta("elegir una plantilla o escribir asunto y cuerpo");
      else if (!plantillaExiste) problemas.push(`${nombre}: la plantilla «${humanizar(plantilla)}» no existe o está desactivada`);
      break;
    case "ENROLL_PLAN": {
      const id = texto(c.planId);
      if (!id) falta("elegir la cadencia");
      else if (fuentes?.cadencias && !Object.prototype.hasOwnProperty.call(fuentes.cadencias, id)) {
        problemas.push(`${nombre}: la cadencia no existe o está apagada`);
      }
      break;
    }
    case "CHANGE_STAGE": {
      const s = texto(c.toStage);
      if (!s) falta("elegir la etapa");
      else if (!STAGE_LABELS[s]) problemas.push(`${nombre}: la etapa «${s}» no existe`);
      break;
    }
    case "SET_LIFECYCLE": {
      const s = texto(c.toStage);
      if (!s) falta("elegir la etapa del ciclo de vida");
      else if (!LIFECYCLE_LABELS[s]) problemas.push(`${nombre}: la etapa «${s}» no existe`);
      break;
    }
    case "ADD_TAG":
      if (!texto(c.tag)) falta("la etiqueta");
      break;
    case "UPDATE_FIELD": {
      const campo = texto(c.field);
      const valor = texto(c.value);
      if (!campo) { falta("elegir el dato a cambiar"); break; }
      if (!(CAMPOS_ACTUALIZABLES as readonly string[]).includes(campo)) {
        problemas.push(`${nombre}: el motor no permite cambiar «${campo}»`);
        break;
      }
      if (!valor) falta("el nuevo valor");
      // Un valor fuera de lista el motor lo omite (contactType/leadSource) o, en los demás, rompe el update.
      else if (!OPCIONES_CAMPO[campo]?.[valor]) problemas.push(`${nombre}: «${valor}» no es un valor válido para ese dato`);
      break;
    }
    case "WEBHOOK": {
      const url = texto(c.url);
      if (!url) falta("la dirección");
      else if (!url.startsWith("https://")) problemas.push(`${nombre}: la dirección debe empezar con https://`);
      break;
    }
    default:
      break;
  }

  for (const campo of def.campos) {
    if (campo.kind === "number" && c[campo.key] != null && c[campo.key] !== "") {
      const n = c[campo.key];
      if (typeof n !== "number" || !Number.isFinite(n) || n < 0) problemas.push(`${nombre}: ${campo.label} debe ser un número`);
    }
  }
  return { ok: problemas.length === 0, problemas };
}

// ── Fuentes ──────────────────────────────────────────────────────────────────────────
/**
 * Convierte la respuesta de `GET /api/admin/automation/fuentes` (`data`) en los mapas que usan
 * las frases. Las plantillas se indexan por id Y por nombre (el motor resuelve `config.template`
 * por cualquiera de los dos) apuntando al mismo nombre.
 */
export function fuentesDesdeRespuesta(data: {
  plantillas?: { id: string; clave?: string | null; nombre: string }[];
  cadencias?: { id: string; nombre: string }[];
  usuarios?: { id: string; nombre: string }[];
} | null | undefined): FuentesDeAccion {
  if (!data) return {};
  const plantillas: Record<string, string> = {};
  for (const p of data.plantillas ?? []) {
    plantillas[p.id] = p.nombre;
    plantillas[p.nombre] = p.nombre;
    if (p.clave) plantillas[p.clave] = p.nombre;
  }
  return {
    plantillas,
    cadencias: Object.fromEntries((data.cadencias ?? []).map((c) => [c.id, c.nombre])),
    usuarios: Object.fromEntries((data.usuarios ?? []).map((u) => [u.id, u.nombre])),
  };
}
