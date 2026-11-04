// «Probar con un contacto» (975): dice, SIN ejecutar nada ni escribir, qué haría una regla (aunque
// no esté guardada) con un contacto concreto. Lógica PURA: el contexto { contact, deal, event,
// context } lo arma quien llama (loadEntityContext en el servidor; aquí se inyecta).
import { evaluateConditions } from "./evaluate-conditions";
import { describeConditions, valueLabel } from "./condition-catalog";
import { describeTrigger } from "./trigger-catalog";
import { describeAction, type FuentesDeAccion } from "./action-catalog";
import type { ConditionNode } from "@/lib/validations/rebuild-f1";

type Ctx = Record<string, unknown>;

export interface ReglaAProbar {
  triggerType: string;
  triggerConfig?: unknown;
  conditions?: unknown;
  actions?: unknown;
}

export interface ResultadoDisparador {
  /** «Esta regla se activa cuando …; así se evaluarían las condiciones ahora.» */
  frase: string;
  /** true/false si el disparador se puede juzgar con el estado actual del contacto; null si es un evento. */
  aplica: boolean | null;
  /** Dato del contacto frente a lo que pide el disparador (solo si `aplica` no es null). */
  detalle: string | null;
}

export interface ResultadoCondicion {
  texto: string;
  cumple: boolean;
  /** Valor actual del contacto en español («Meta Ads», «Sin dato», «Sí»). */
  actual: string;
}

export interface ResultadoPrueba {
  disparador: ResultadoDisparador;
  /** Hojas del árbol de condiciones, en orden. Vacío = la regla no tiene condiciones. */
  condiciones: ResultadoCondicion[];
  /** Frase completa de las condiciones («fuente es Meta Ads y score al menos 50»); "" si no hay. */
  condicionesFrase: string;
  condicionesCumplen: boolean;
  /** Las acciones corren si el disparador no descarta al contacto y las condiciones se cumplen. */
  correria: boolean;
  veredicto: string;
  /** Una frase por acción (con su retraso). Solo informativo: no se ejecutan. */
  acciones: string[];
}

const SIN_DATO = "Sin dato";

function resolver(ctx: Ctx, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, k) => (acc != null && typeof acc === "object" ? (acc as Ctx)[k] : undefined), ctx);
}

/** Valor del contacto para una hoja, listo para leerse. */
function valorActual(ctx: Ctx, field: string): string {
  const raw = resolver(ctx, field);
  if (raw === undefined || raw === null || raw === "" || (Array.isArray(raw) && raw.length === 0)) {
    if (field.startsWith("deal.") && ctx.deal == null) return "Sin dato (el contacto no tiene negocio)";
    return SIN_DATO;
  }
  return valueLabel(field, raw) || SIN_DATO;
}

function hojas(node: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (!node || typeof node !== "object") return out;
  const n = node as Record<string, unknown>;
  if (Array.isArray(n.all)) n.all.forEach((c) => hojas(c, out));
  else if (Array.isArray(n.any)) n.any.forEach((c) => hojas(c, out));
  else if (typeof n.field === "string" && typeof n.op === "string") out.push(n);
  return out;
}

function disparadorAplica(regla: ReglaAProbar, ctx: Ctx): Pick<ResultadoDisparador, "aplica" | "detalle"> {
  const cfg = (regla.triggerConfig ?? {}) as Record<string, unknown>;
  const contacto = (ctx.contact ?? {}) as Record<string, unknown>;
  if (regla.triggerType === "SCORE_THRESHOLD" && typeof cfg.threshold === "number") {
    const score = Number(contacto.score ?? 0);
    return {
      aplica: score >= cfg.threshold,
      detalle: `Score actual ${valueLabel("contact.score", score)}; la regla pide ${valueLabel("contact.score", cfg.threshold)} o más.`,
    };
  }
  if (regla.triggerType === "LIFECYCLE_CHANGE" && typeof cfg.toStage === "string") {
    const actual = valueLabel("contact.lifecycleStage", contacto.lifecycleStage);
    return {
      aplica: contacto.lifecycleStage === cfg.toStage,
      detalle: `Etapa actual: ${actual || SIN_DATO}; la regla espera ${valueLabel("contact.lifecycleStage", cfg.toStage)}.`,
    };
  }
  return { aplica: null, detalle: null };
}

/** Evento que el motor emitiría para este disparador (para evaluar `event.type` como lo haría el motor). */
export function eventoDeDisparador(regla: ReglaAProbar): string | undefined {
  const cfg = (regla.triggerConfig ?? {}) as Record<string, unknown>;
  switch (regla.triggerType) {
    case "EVENT":
    case "BEHAVIORAL": return typeof cfg.eventType === "string" ? cfg.eventType : undefined;
    case "STAGE_CHANGE": return "deal.stage_changed";
    case "LIFECYCLE_CHANGE": return "contact.lifecycle_changed";
    case "SCORE_THRESHOLD": return "contact.scored";
    case "SLA_BREACH": return "sla.breach";
    default: return undefined;
  }
}

export function probarRegla(regla: ReglaAProbar, ctx: Ctx, fuentes?: FuentesDeAccion): ResultadoPrueba {
  const frase = describeTrigger(regla.triggerType, regla.triggerConfig);
  const { aplica, detalle } = disparadorAplica(regla, ctx);
  const disparador: ResultadoDisparador = {
    frase: `Esta regla se activa cuando ${frase}; así se evaluarían las condiciones ahora.`,
    aplica,
    detalle,
  };

  const arbol = (regla.conditions ?? {}) as ConditionNode | Record<string, never>;
  const condiciones = hojas(arbol).map((h) => ({
    texto: describeConditions(h),
    cumple: evaluateConditions(h as unknown as ConditionNode, ctx),
    actual: valorActual(ctx, h.field as string),
  }));
  const condicionesFrase = describeConditions(arbol, { vacio: "" });
  const condicionesCumplen = evaluateConditions(arbol, ctx);

  const acciones = (Array.isArray(regla.actions) ? regla.actions : [])
    .filter((a): a is Record<string, unknown> => !!a && typeof a === "object")
    .map((a) => describeAction(a as never, fuentes, { conRetraso: true }));

  const correria = aplica !== false && condicionesCumplen;
  let veredicto: string;
  if (aplica === false) veredicto = "No correría: el contacto no cumple el disparador de la regla.";
  else if (!condicionesCumplen) veredicto = "No correría: no se cumplen las condiciones.";
  else if (acciones.length === 0) veredicto = "Aplicaría, pero la regla no tiene acciones.";
  else veredicto = "Correría con este contacto.";

  return { disparador, condiciones, condicionesFrase, condicionesCumplen, correria, veredicto, acciones };
}
