// Lógica pura del constructor de reglas "Cuando · Si · Entonces" (E3, 964). Sin React.
// Arma y parsea una regla completa sin perder lo que el motor lee: claves extra del
// disparador (p. ej. `field` de INACTIVITY), claves de primer nivel de cada acción
// (`autonomyLevel`) y la config de cada acción (la conserva `configParaGuardar`).
import {
  parseConditions, hasDecisionNode, type ConditionTree,
} from "@/lib/workflows/builder-model";
import {
  DISPARADORES, GRUPOS_DE_DISPARADOR, disparadorDesde, disparadorPorKey, triggerConfigDesde,
  triggerTypeDe, validarDisparador, describeTrigger, type Disparador, type GrupoDeDisparador,
} from "@/lib/workflows/trigger-catalog";
import {
  describeRule, validarAccion, type FuentesDeAccion,
} from "@/lib/workflows/action-catalog";
import { campoPorKey, type ContextoDeCondicion } from "@/lib/workflows/condition-catalog";
import { buildConditionsTreeGuiado, problemasDeCondiciones } from "./condition-tree-model";
import type { AccionEditable } from "./action-card-model";
import type { RuleTemplate } from "@/lib/workflows/builder-templates";

// ── Guard de ramas ───────────────────────────────────────────────────────────────────
// Una regla armada en el lienzo de Journey puede traer nodos `kind:"decision"` que este
// constructor lineal no sabe representar. Si se "guardara", `actions` se aplanaría y las ramas
// se perderían. `shouldGuardRule` es la única fuente de esa decisión.
export function shouldGuardRule(rule: { actions?: unknown } | null | undefined): boolean {
  return hasDecisionNode(rule?.actions);
}

export const DECISION_GUARD_MESSAGE =
  "Esta regla usa ramas de decisión; edítala en el canvas de Journey para no perder su estructura.";

// ── Presets ──────────────────────────────────────────────────────────────────────────
export const PRESETS_NO_REPETIR: { label: string; minutes: number }[] = [
  { label: "Sin límite", minutes: 0 },
  { label: "1 h", minutes: 60 },
  { label: "1 día", minutes: 1440 },
  { label: "7 días", minutes: 10080 },
];

// ── Borrador ─────────────────────────────────────────────────────────────────────────
/** Una acción del borrador: lo que edita la tarjeta + claves de primer nivel que no se tocan (autonomyLevel…). */
export type AccionDeBorrador = AccionEditable & Record<string, unknown>;

export interface BorradorDeRegla {
  name: string;
  description: string;
  /** Clave del disparador (trigger-catalog). */
  triggerKey: string;
  triggerValue: string;
  /** Lo guardado originalmente: conserva claves extra y permite no tocar disparadores fuera del catálogo. */
  triggerOriginal: { triggerType: string; triggerConfig: Record<string, unknown> } | null;
  tree: ConditionTree;
  actions: AccionDeBorrador[];
  priority: string;
  cooldown: string;
}

type ReglaGuardada = {
  name?: string; description?: string | null; triggerType?: string; triggerConfig?: unknown;
  conditions?: unknown; actions?: unknown; priority?: number | null; cooldownMinutes?: number | null;
} | null | undefined;

function aObjeto(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function accionesDesde(actions: unknown): AccionDeBorrador[] {
  if (!Array.isArray(actions)) return [];
  return actions
    .filter((a): a is Record<string, unknown> => !!a && typeof a === "object" && typeof (a as { type?: unknown }).type === "string")
    .map((a) => ({ ...a, type: a.type as string, config: aObjeto(a.config) }));
}

/** Borrador vacío para una regla nueva. */
export function borradorNuevo(): BorradorDeRegla {
  return {
    name: "", description: "", triggerKey: "lead.captured", triggerValue: "", triggerOriginal: null,
    tree: { combinator: "all", items: [] }, actions: [], priority: "100", cooldown: "",
  };
}

/** Regla guardada → borrador editable. */
export function borradorDesdeRegla(rule: ReglaGuardada): BorradorDeRegla {
  if (!rule) return borradorNuevo();
  const triggerType = rule.triggerType ?? "EVENT";
  const triggerConfig = aObjeto(rule.triggerConfig);
  const { key, valor } = disparadorDesde(triggerType, triggerConfig);
  return {
    name: rule.name ?? "",
    description: rule.description ?? "",
    triggerKey: key,
    triggerValue: valor,
    triggerOriginal: { triggerType, triggerConfig },
    tree: parseConditions(rule.conditions),
    actions: accionesDesde(rule.actions),
    priority: String(rule.priority ?? 100),
    cooldown: rule.cooldownMinutes != null ? String(rule.cooldownMinutes) : "",
  };
}

/** Plantilla de regla → borrador (conserva el estado "nueva": sin disparador original). */
export function borradorDesdePlantilla(t: RuleTemplate): BorradorDeRegla {
  const base = borradorDesdeRegla({ ...t.rule });
  return { ...base, triggerOriginal: null, priority: "100" };
}

// ── Disparador ───────────────────────────────────────────────────────────────────────
const CLAVES_DEL_DISPARADOR = ["eventType", "toStage", "stage", "threshold", "hours"];

/**
 * Disparador listo para guardar. Fusiona `triggerConfigDesde` sobre el `triggerConfig` original
 * (sin las claves que el constructor posee) para no perder claves extra como `field`; si cambió
 * el tipo de disparador no se arrastra nada. Un disparador fuera del catálogo que no se tocó se
 * guarda tal cual estaba.
 */
export function armarDisparadorDeBorrador(b: BorradorDeRegla): { triggerType: string; triggerConfig: Record<string, unknown> } {
  const original = b.triggerOriginal;
  const d = disparadorPorKey(b.triggerKey);
  const mismaClave = !!original && disparadorDesde(original.triggerType, original.triggerConfig).key === b.triggerKey;
  if (!d && original && mismaClave) return { triggerType: original.triggerType, triggerConfig: original.triggerConfig };
  const triggerType = triggerTypeDe(b.triggerKey);
  const nuevo = triggerConfigDesde(b.triggerKey, b.triggerValue);
  if (original && mismaClave && original.triggerType === triggerType) {
    const extras = Object.fromEntries(Object.entries(original.triggerConfig).filter(([k]) => !CLAVES_DEL_DISPARADOR.includes(k)));
    return { triggerType, triggerConfig: { ...extras, ...nuevo } };
  }
  return { triggerType, triggerConfig: nuevo };
}

export function contextoDeDisparador(key: string): ContextoDeCondicion {
  return disparadorPorKey(key)?.contexto ?? "contact";
}

/** El disparador elegido no lo ejecuta el motor (o no existe en el catálogo). */
export function avisoDeDisparador(key: string): string | null {
  const d = disparadorPorKey(key);
  if (!d) return key ? "Este disparador no está en la lista; se conserva tal como estaba." : null;
  if (d.estado === "proximamente") return d.ayuda ?? "Todavía no se ejecuta desde el sistema: la regla se guarda pero no se dispara.";
  return null;
}

export interface GrupoDeDisparadores { grupo: GrupoDeDisparador; disparadores: Disparador[] }

/** Disparadores ofrecibles agrupados: solo `activo`, más el actual aunque sea `proximamente`. */
export function disparadoresAgrupados(keyActual: string): GrupoDeDisparadores[] {
  return GRUPOS_DE_DISPARADOR
    .map((grupo) => ({
      grupo,
      disparadores: DISPARADORES.filter((d) => d.grupo === grupo && (d.estado === "activo" || d.key === keyActual)),
    }))
    .filter((g) => g.disparadores.length > 0);
}

/** Cambiar de disparador limpia el valor (era del anterior). */
export function cambiarDisparador(b: BorradorDeRegla, key: string): BorradorDeRegla {
  return key === b.triggerKey ? b : { ...b, triggerKey: key, triggerValue: "" };
}

// ── Acciones ─────────────────────────────────────────────────────────────────────────
/** Aplica lo que devuelve `ActionCard.onChange` sin perder claves de primer nivel (autonomyLevel…). */
export function fusionarAccion(prev: AccionDeBorrador, next: AccionEditable): AccionDeBorrador {
  const out: AccionDeBorrador = { ...prev, type: next.type, config: next.config };
  if (typeof next.delayMinutes === "number" && next.delayMinutes > 0) out.delayMinutes = next.delayMinutes;
  else delete out.delayMinutes;
  return out;
}

export function agregarAccion(items: AccionDeBorrador[], nueva: AccionEditable): AccionDeBorrador[] {
  return [...items, { ...nueva }];
}

export function moverAccion<T>(items: T[], index: number, dir: -1 | 1): T[] {
  const to = index + dir;
  if (index < 0 || index >= items.length || to < 0 || to >= items.length) return items;
  const out = [...items];
  [out[index], out[to]] = [out[to], out[index]];
  return out;
}

export function quitarAccion<T>(items: T[], index: number): T[] {
  return items.filter((_, i) => i !== index);
}

/** Después de quitar/mover, a qué tarjeta sigue abierta (índice o null). */
export function indiceAbiertoTrasMover(abierta: number | null, from: number, to: number): number | null {
  if (abierta === null) return null;
  if (abierta === from) return to;
  if (abierta === to) return from;
  return abierta;
}

export function indiceAbiertoTrasQuitar(abierta: number | null, quitado: number): number | null {
  if (abierta === null || abierta === quitado) return null;
  return abierta > quitado ? abierta - 1 : abierta;
}

// ── Guardado ─────────────────────────────────────────────────────────────────────────
export interface PayloadDeRegla {
  id?: string;
  name: string;
  description: string | null;
  triggerType: string;
  triggerConfig: Record<string, unknown>;
  conditions: Record<string, unknown>;
  actions: Record<string, unknown>[];
  priority: number;
  cooldownMinutes: number | null;
  isActive: boolean;
}

/**
 * Las filas de un campo fuera del catálogo (p. ej. `deal.hasQuote`) pasan por `parseValue`, que deja
 * "true"/"false" como texto; el evaluador compara con `===` y la regla dejaría de cumplirse. Aquí se
 * devuelven a boolean real. Los campos del catálogo ya vienen tipados.
 */
export function normalizarBooleanos(dsl: unknown): Record<string, unknown> {
  const rec = (n: unknown): unknown => {
    if (!n || typeof n !== "object") return n;
    const o = n as Record<string, unknown>;
    if (Array.isArray(o.all)) return { ...o, all: o.all.map(rec) };
    if (Array.isArray(o.any)) return { ...o, any: o.any.map(rec) };
    if (typeof o.field === "string" && !campoPorKey(o.field) && (o.value === "true" || o.value === "false")) {
      return { ...o, value: o.value === "true" };
    }
    return o;
  };
  return rec(dsl) as Record<string, unknown>;
}

function accionAGuardar(a: AccionDeBorrador): Record<string, unknown> {
  const { delayMinutes, ...resto } = a;
  return typeof delayMinutes === "number" && delayMinutes > 0 ? { ...resto, delayMinutes } : resto;
}

export function payloadDeBorrador(b: BorradorDeRegla, opts: { id?: string; activate: boolean }): PayloadDeRegla {
  const { triggerType, triggerConfig } = armarDisparadorDeBorrador(b);
  const cooldown = Number(b.cooldown);
  return {
    ...(opts.id ? { id: opts.id } : {}),
    name: b.name.trim(),
    description: b.description.trim() || null,
    triggerType,
    triggerConfig,
    conditions: normalizarBooleanos(buildConditionsTreeGuiado(b.tree)),
    actions: b.actions.map(accionAGuardar),
    priority: Number(b.priority) || 100,
    cooldownMinutes: b.cooldown.trim() !== "" && Number.isFinite(cooldown) && cooldown > 0 ? cooldown : null,
    isActive: opts.activate,
  };
}

/** Frase viva de la regla en edición ("Cuando … · si … · entonces …"). */
export function fraseDeBorrador(b: BorradorDeRegla, fuentes?: FuentesDeAccion): string {
  const p = payloadDeBorrador(b, { activate: false });
  return describeRule(p, fuentes);
}

export function fraseDeDisparador(b: BorradorDeRegla): string {
  const { triggerType, triggerConfig } = armarDisparadorDeBorrador(b);
  return describeTrigger(triggerType, triggerConfig);
}

/** Frase de una plantilla de regla (para mostrarla en el selector de plantillas). */
export function fraseDePlantilla(t: RuleTemplate, fuentes?: FuentesDeAccion): string {
  return describeRule(t.rule, fuentes);
}

// ── Validación ───────────────────────────────────────────────────────────────────────
export type CampoConProblema = "name" | "trigger" | "conditions" | "actions" | "priority" | "cooldown";
export interface ProblemaDeBorrador { campo: CampoConProblema; mensaje: string }

export function validarBorrador(b: BorradorDeRegla, fuentes?: FuentesDeAccion): ProblemaDeBorrador[] {
  const out: ProblemaDeBorrador[] = [];
  if (b.name.trim().length < 3) out.push({ campo: "name", mensaje: "El nombre debe tener al menos 3 caracteres." });
  // Un disparador fuera del catálogo sin tocar no se valida contra el catálogo.
  if (disparadorPorKey(b.triggerKey) || !b.triggerOriginal) {
    for (const m of validarDisparador(b.triggerKey, b.triggerValue).problemas) out.push({ campo: "trigger", mensaje: m });
  }
  for (const m of problemasDeCondiciones(b.tree)) out.push({ campo: "conditions", mensaje: m });
  if (b.actions.length === 0) out.push({ campo: "actions", mensaje: "Agrega al menos una acción." });
  b.actions.forEach((a, i) => {
    for (const m of validarAccion(a, fuentes).problemas) out.push({ campo: "actions", mensaje: `Acción ${i + 1}: ${m}` });
  });
  if (b.priority.trim() !== "" && !Number.isFinite(Number(b.priority))) out.push({ campo: "priority", mensaje: "La prioridad debe ser un número." });
  if (b.cooldown.trim() !== "" && (!Number.isFinite(Number(b.cooldown)) || Number(b.cooldown) < 0)) {
    out.push({ campo: "cooldown", mensaje: "El plazo para no repetir debe ser un número." });
  }
  return out;
}

/** Agrupa los problemas por campo (primer mensaje de cada uno), como `erroresPorCampo`. */
export function problemasPorCampo(problemas: ProblemaDeBorrador[]): Partial<Record<CampoConProblema, string[]>> {
  const out: Partial<Record<CampoConProblema, string[]>> = {};
  for (const p of problemas) (out[p.campo] ??= []).push(p.mensaje);
  return out;
}

/** Vista JSON de solo lectura para "Avanzado". */
export function jsonDeSoloLectura(b: BorradorDeRegla): string {
  const p = payloadDeBorrador(b, { activate: false });
  return JSON.stringify({ triggerType: p.triggerType, triggerConfig: p.triggerConfig, conditions: p.conditions, actions: p.actions }, null, 2);
}
