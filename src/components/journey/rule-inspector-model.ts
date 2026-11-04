// Logica pura del inspector del lienzo (E4-B): que selector/campos salen para cada nodo y como
// se mapea el borrador (RuleDraft) con lo que edita la UI. Sin React.
// Reutiliza los catalogos de Configuracion (disparadores, acciones, condiciones).
import {
  DISPARADORES, GRUPOS_DE_DISPARADOR, armarDisparador, disparadorDesde, disparadorPorKey,
  type CampoDeDisparador, type Disparador, type GrupoDeDisparador,
} from "@/lib/workflows/trigger-catalog";
import {
  accionPorTipo, camposVisibles, configParaGuardar, describeAction, validarAccion,
  type AccionDeCatalogo, type CampoDeAccion, type FuentesDeAccion,
} from "@/lib/workflows/action-catalog";
import { describeConditions, type ContextoDeCondicion } from "@/lib/workflows/condition-catalog";
import { accionesAgrupadas, rawDesdeConfig, retrasoATexto, retrasoDesdeTexto } from "@/components/config/action-card-model";
import type { ActionNodeDraft, BranchDraft, Conditions, NodeDraft } from "@/lib/journey/rule-draft";
import { isDecisionDraft } from "@/lib/journey/rule-draft";

export { rawDesdeConfig, retrasoATexto, retrasoDesdeTexto };

// -- Que se muestra para la seleccion -------------------------------------------------
export type VistaDeInspector = "disparador" | "condicion" | "decision" | "accion" | "regla";

export function findNode(nodes: NodeDraft[], id: string): NodeDraft | undefined {
  for (const n of nodes) {
    if (n.nodeId === id) return n;
    if (isDecisionDraft(n)) {
      for (const b of n.branches) { const f = findNode(b.steps, id); if (f) return f; }
      if (n.else) { const f = findNode(n.else, id); if (f) return f; }
    }
  }
  return undefined;
}

export function vistaDeInspector(actions: NodeDraft[], selectedId: string | null): VistaDeInspector {
  if (selectedId === "trigger") return "disparador";
  if (selectedId === "condition") return "condicion";
  if (!selectedId) return "regla";
  const n = findNode(actions, selectedId);
  if (!n) return "regla";
  return isDecisionDraft(n) ? "decision" : "accion";
}

// -- Disparador -----------------------------------------------------------------------
export interface OpcionDisparador { key: string; label: string; proximamente: boolean }
export interface GrupoOpcionesDisparador { grupo: GrupoDeDisparador | "Actual"; opciones: OpcionDisparador[] }
export interface SelectorDeDisparador {
  key: string;
  valor: string;
  disparador: Disparador | undefined;
  grupos: GrupoOpcionesDisparador[];
  campo: CampoDeDisparador | undefined;
  /** Aviso cuando el disparador actual no dispara todavia o no esta en el catalogo. */
  aviso: string | null;
}

export function selectorDeDisparador(triggerType: string, triggerConfig: unknown): SelectorDeDisparador {
  const { key, valor } = disparadorDesde(triggerType, triggerConfig);
  const actual = disparadorPorKey(key);
  const grupos: GrupoOpcionesDisparador[] = GRUPOS_DE_DISPARADOR
    .map((grupo) => ({
      grupo,
      opciones: DISPARADORES
        .filter((d) => d.grupo === grupo && (d.estado === "activo" || d.key === key))
        .map((d) => ({ key: d.key, label: d.label, proximamente: d.estado === "proximamente" })),
    }))
    .filter((g) => g.opciones.length > 0);
  // Evento fuera del catalogo: se conserva visible para no borrarlo al abrir el panel.
  if (!actual && key) grupos.push({ grupo: "Actual", opciones: [{ key, label: key, proximamente: false }] });
  let aviso: string | null = null;
  if (actual?.estado === "proximamente") aviso = actual.ayuda ?? "Este disparador todavía no se emite desde el sistema.";
  else if (!actual && key) aviso = "Este evento no está en el catálogo de disparadores.";
  return { key, valor, disparador: actual, grupos, campo: actual?.campo, aviso };
}

/** Al elegir otro disparador el valor del campo se limpia (el campo cambia de significado). */
export function disparadorAlElegir(key: string) {
  return armarDisparador(key, "");
}

export function disparadorAlEditarValor(key: string, valor: string) {
  return armarDisparador(key, valor);
}

/** Contexto de datos para las condiciones, derivado del disparador de la regla. */
export function contextoDeRegla(triggerType: string, triggerConfig: unknown): ContextoDeCondicion {
  return disparadorPorKey(disparadorDesde(triggerType, triggerConfig).key)?.contexto ?? "contact";
}

// -- Accion ---------------------------------------------------------------------------
export interface VistaDeAccion {
  titulo: string;
  campos: CampoDeAccion[];
  desconocida: boolean;
  proximamente: boolean;
}

export function vistaDeAccion(node: ActionNodeDraft, fuentes?: FuentesDeAccion): VistaDeAccion {
  const def = accionPorTipo(node.type);
  return {
    titulo: describeAction({ type: node.type, config: node.config, delayMinutes: node.delayMinutes }, fuentes),
    campos: camposVisibles(node.type, node.config),
    desconocida: !def,
    proximamente: def?.estado === "proximamente",
  };
}

export function problemasDeNodo(node: ActionNodeDraft, fuentes?: FuentesDeAccion): string[] {
  return validarAccion({ type: node.type, config: node.config, delayMinutes: node.delayMinutes }, fuentes).problemas;
}

export interface GrupoOpcionesAccion { grupo: string; acciones: { type: string; label: string }[] }

/** Tipos para el selector de accion: activas agrupadas + el tipo actual si no es ofrecible. */
export function opcionesDeTipoDeAccion(tipoActual: string): GrupoOpcionesAccion[] {
  const grupos: GrupoOpcionesAccion[] = accionesAgrupadas().map((g) => ({
    grupo: g.grupo,
    acciones: g.acciones.map((a: AccionDeCatalogo) => ({ type: a.type, label: a.label })),
  }));
  const ofrecido = grupos.some((g) => g.acciones.some((a) => a.type === tipoActual));
  if (!ofrecido && tipoActual) {
    const def = accionPorTipo(tipoActual);
    grupos.push({
      grupo: "Actual",
      acciones: [{ type: tipoActual, label: def ? `${def.label} (próximamente)` : tipoActual }],
    });
  }
  return grupos;
}

/**
 * Cambio de `raw` (lo que edita la UI) -> parche para `setActionConfig` (que mezcla con spread).
 * Las claves que dejan de existir se emiten como `undefined` para borrarlas de la config.
 */
export function parcheDeConfig(
  type: string, configActual: Record<string, unknown>, raw: Record<string, unknown>,
): Record<string, unknown> {
  const nueva = configParaGuardar(type, raw);
  const parche: Record<string, unknown> = {};
  for (const k of Object.keys(configActual)) if (!(k in nueva)) parche[k] = undefined;
  for (const [k, v] of Object.entries(nueva)) if (JSON.stringify(configActual[k]) !== JSON.stringify(v)) parche[k] = v;
  return parche;
}

/** Firma estable de una config (claves ordenadas, sin undefined) para detectar cambios externos. */
export function firmaDeConfig(config: Record<string, unknown> | null | undefined): string {
  const ordenar = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(ordenar);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .filter(([, x]) => x !== undefined)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, x]) => [k, ordenar(x)]),
      );
    }
    return v;
  };
  return JSON.stringify(ordenar(config ?? {}));
}

/** Retraso: texto del DelayInput -> minutos para `setActionDelay` (0 = inmediata). */
export function minutosDeRetraso(texto: string): number {
  return retrasoDesdeTexto(texto) ?? 0;
}

// -- Ramas de decision ----------------------------------------------------------------
export function fraseDeCondicion(conditions: Conditions): string {
  return describeConditions(conditions, { vacio: "siempre" });
}

export function tituloDeRama(branch: Pick<BranchDraft, "conditions" | "label">, indice: number): string {
  const frase = fraseDeCondicion(branch.conditions);
  const nombre = branch.label?.trim();
  return nombre ? `${nombre}: ${frase}` : `Rama ${indice + 1}: ${frase}`;
}

// -- Paleta ---------------------------------------------------------------------------
export function paletaDeAcciones(): { grupo: string; items: { type: string; label: string }[] }[] {
  return accionesAgrupadas().map((g) => ({
    grupo: g.grupo,
    items: g.acciones.map((a) => ({ type: a.type, label: a.label })),
  }));
}
