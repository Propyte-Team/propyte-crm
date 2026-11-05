// Núcleo puro del canvas editable (C.2-i2). Sin React, sin React Flow.
// El draft tiene la MISMA forma que AutomationRule → round-trip exacto.
import { conditionsDslSchema } from "@/lib/validations/rebuild-f1";
import type { WorkflowNode } from "@/lib/validations/rebuild-f1";
import type { z } from "zod";
import type { Flow, RFNode, RFEdge } from "./flow-adapter";
import { armarDisparador } from "@/lib/workflows/trigger-catalog";
import { PIPELINE_STAGES } from "@/lib/constants";

export type Conditions = z.infer<typeof conditionsDslSchema>;

export interface RuleRow {
  id: string;
  name: string;
  description: string | null;
  triggerType: string;
  triggerConfig: Record<string, unknown>;
  conditions: Conditions;
  actions: WorkflowNode[];
  cooldownMinutes: number | null;
  priority: number;
  isActive: boolean;
}

// ─── Draft tree types ─────────────────────────────────────────────────────────

export interface ActionNodeDraft {
  nodeId: string;
  kind?: "action";
  type: string;
  config: Record<string, unknown>;
  delayMinutes?: number;
  autonomyLevel?: string;
}

export interface BranchDraft {
  branchId: string;
  label?: string;
  conditions: Conditions;
  steps: NodeDraft[];
}

export interface DecisionNodeDraft {
  nodeId: string;
  kind: "decision";
  label?: string;
  branches: BranchDraft[];
  else?: NodeDraft[];
}

export type NodeDraft = ActionNodeDraft | DecisionNodeDraft;

export function isDecisionDraft(n: NodeDraft): n is DecisionNodeDraft {
  return n.kind === "decision";
}

/** @deprecated Use NodeDraft instead. Kept for backward compat until T8/T9. */
export type ActionDraft = ActionNodeDraft;

export interface RuleDraft {
  id?: string;
  name: string;
  description: string | null;
  triggerType: string;
  triggerConfig: Record<string, unknown>;
  conditions: Conditions;
  actions: NodeDraft[];
  cooldownMinutes: number | null;
  priority: number;
  isActive: boolean;
}

export interface RulePayload {
  id?: string;
  name: string;
  description: string | null;
  triggerType: string;
  triggerConfig: Record<string, unknown>;
  conditions: Conditions;
  actions: WorkflowNode[];
  cooldownMinutes: number | null;
  priority: number;
  isActive: boolean;
}

// ─── Recursive helpers ────────────────────────────────────────────────────────

function nodeToDraft(node: WorkflowNode, path: string): NodeDraft {
  if ((node as { kind?: string }).kind === "decision") {
    const d = node as Extract<WorkflowNode, { kind: "decision" }>;
    return {
      nodeId: path,
      kind: "decision",
      ...(d.label !== undefined ? { label: d.label } : {}),
      branches: d.branches.map((b, bi) => ({
        branchId: `${path}.b${bi}`,
        ...(b.label !== undefined ? { label: b.label } : {}),
        conditions: (b.conditions ?? {}) as Conditions,
        steps: b.steps.map((s, si) => nodeToDraft(s, `${path}.b${bi}.${si}`)),
      })),
      ...(d.else ? { else: d.else.map((s, si) => nodeToDraft(s, `${path}.else.${si}`)) } : {}),
    };
  }
  const a = node as Extract<WorkflowNode, { type: string }>;
  return {
    nodeId: path,
    type: a.type,
    config: (a.config ?? {}) as Record<string, unknown>,
    ...(a.delayMinutes !== undefined ? { delayMinutes: a.delayMinutes } : {}),
    ...((a as { autonomyLevel?: string }).autonomyLevel !== undefined
      ? { autonomyLevel: (a as { autonomyLevel?: string }).autonomyLevel }
      : {}),
  };
}

function draftToNode(n: NodeDraft): WorkflowNode {
  if (isDecisionDraft(n)) {
    return {
      kind: "decision",
      ...(n.label !== undefined ? { label: n.label } : {}),
      branches: n.branches.map((b) => ({
        ...(b.label !== undefined ? { label: b.label } : {}),
        conditions: b.conditions,
        steps: b.steps.map(draftToNode),
      })),
      ...(n.else ? { else: n.else.map(draftToNode) } : {}),
    } as WorkflowNode;
  }
  return {
    type: n.type,
    config: n.config,
    ...(n.delayMinutes !== undefined ? { delayMinutes: n.delayMinutes } : {}),
    ...(n.autonomyLevel !== undefined ? { autonomyLevel: n.autonomyLevel } : {}),
  } as WorkflowNode;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function ruleToDraft(row: RuleRow): RuleDraft {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    triggerType: row.triggerType,
    triggerConfig: row.triggerConfig ?? {},
    conditions: row.conditions ?? {},
    actions: (Array.isArray(row.actions) ? row.actions : []).map((n, i) =>
      nodeToDraft(n, `a${i}`),
    ),
    cooldownMinutes: row.cooldownMinutes,
    priority: row.priority,
    isActive: row.isActive,
  };
}

const LANE_W = 240;

function conditionsEmpty(c: Conditions): boolean {
  if (!c || typeof c !== "object") return true;
  const o = c as Record<string, unknown>;
  const all = Array.isArray(o.all) ? o.all.length : 0;
  const any = Array.isArray(o.any) ? o.any.length : 0;
  return all === 0 && any === 0 && typeof o.field !== "string";
}

export function draftToFlow(draft: RuleDraft): Flow {
  const nodes: RFNode[] = [];
  const edges: RFEdge[] = [];
  let col = 0;
  const place = (id: string, type: string, data: Record<string, unknown>, depth: number) => {
    nodes.push({ id, type, position: { x: col * LANE_W, y: depth * 90 }, data });
    col++;
  };

  place("trigger", "trigger", { triggerType: draft.triggerType, triggerConfig: draft.triggerConfig, label: draft.name }, 0);
  let lastLinear = "trigger";
  if (!conditionsEmpty(draft.conditions)) {
    place("condition", "condition", { conditions: draft.conditions }, 0);
    edges.push({ id: `trigger->condition`, source: "trigger", target: "condition" });
    lastLinear = "condition";
  }

  // Encadena `list` a partir de `parentId`. `firstEdgeLabel` etiqueta SOLO la arista
  // que conecta el primer nodo de la lista (para nombrar la rama de una decisión).
  // `firstEdgeBranchId` se añade al data de esa misma arista para el overlay de métricas.
  function emit(list: NodeDraft[], parentId: string, depth: number, firstEdgeLabel?: string, firstEdgeBranchId?: string): string {
    let prev = parentId;
    list.forEach((n, idx) => {
      const linkLabel = idx === 0 ? firstEdgeLabel : undefined;
      const linkBranchId = idx === 0 ? firstEdgeBranchId : undefined;
      const edge = (target: string): RFEdge => ({
        id: `${prev}->${target}`, source: prev, target,
        ...(linkLabel || linkBranchId ? { data: { ...(linkLabel ? { label: linkLabel } : {}), ...(linkBranchId ? { branchId: linkBranchId } : {}) } } : {}),
      });
      if (isDecisionDraft(n)) {
        place(n.nodeId, "decision", { label: n.label ?? "Decisión" }, depth);
        edges.push(edge(n.nodeId));
        n.branches.forEach((b, bi) => {
          if (b.steps.length > 0) emit(b.steps, n.nodeId, depth + 1, b.label ?? "rama", `${n.nodeId}.b${bi}`);
        });
        if (n.else && n.else.length > 0) emit(n.else, n.nodeId, depth + 1, "por defecto", `${n.nodeId}.else`);
        prev = n.nodeId; // tras una decisión, el hermano siguiente cuelga de la decisión
      } else {
        const isStage = n.type === "CHANGE_STAGE";
        place(n.nodeId, isStage ? "stage" : "action", { actionType: n.type, config: n.config, delayMinutes: n.delayMinutes }, depth);
        edges.push(edge(n.nodeId));
        prev = n.nodeId;
      }
    });
    return prev;
  }

  emit(draft.actions, lastLinear, 1);
  return { nodes, edges };
}

// Pure edit ops (tree-aware, T8)

// Reasigna TODOS los ids de forma estable, igual que ruleToDraft.
function rebuildBranchIds(nodes: NodeDraft[], prefix = ""): NodeDraft[] {
  return nodes.map((n, i) => {
    const path = prefix ? `${prefix}.${i}` : `a${i}`;
    if (isDecisionDraft(n)) {
      return {
        ...n, nodeId: path,
        branches: n.branches.map((b, bi) => ({ ...b, branchId: `${path}.b${bi}`, steps: rebuildBranchIds(b.steps, `${path}.b${bi}`) })),
        ...(n.else ? { else: rebuildBranchIds(n.else, `${path}.else`) } : {}),
      };
    }
    return { ...n, nodeId: path };
  });
}

// Aplica fn al nodo con nodeId == id en cualquier nivel.
function mapNodeById(nodes: NodeDraft[], id: string, fn: (n: NodeDraft) => NodeDraft): NodeDraft[] {
  return nodes.map((n) => {
    if (n.nodeId === id) return fn(n);
    if (isDecisionDraft(n)) {
      return {
        ...n,
        branches: n.branches.map((b) => ({ ...b, steps: mapNodeById(b.steps, id, fn) })),
        ...(n.else ? { else: mapNodeById(n.else, id, fn) } : {}),
      };
    }
    return n;
  });
}

// Aplica fn a la rama con branchId == bid en cualquier decision del arbol.
function mapBranchById(nodes: NodeDraft[], bid: string, fn: (b: BranchDraft) => BranchDraft): NodeDraft[] {
  return nodes.map((n) => {
    if (isDecisionDraft(n)) {
      return {
        ...n,
        branches: n.branches.map((b) => (b.branchId === bid ? fn(b) : { ...b, steps: mapBranchById(b.steps, bid, fn) })),
        ...(n.else ? { else: mapBranchById(n.else, bid, fn) } : {}),
      };
    }
    return n;
  });
}

// Elimina el nodo con nodeId == id en cualquier nivel.
function filterNodeById(nodes: NodeDraft[], id: string): NodeDraft[] {
  return nodes
    .filter((n) => n.nodeId !== id)
    .map((n) =>
      isDecisionDraft(n)
        ? {
            ...n,
            branches: n.branches.map((b) => ({ ...b, steps: filterNodeById(b.steps, id) })),
            ...(n.else ? { else: filterNodeById(n.else, id) } : {}),
          }
        : n,
    );
}

export function addAction(draft: RuleDraft, type: string): RuleDraft {
  return { ...draft, actions: rebuildBranchIds([...draft.actions, { nodeId: "", type, config: {} }]) };
}
export function insertAction(draft: RuleDraft, type: string, atIndex: number): RuleDraft {
  const i = Math.max(0, Math.min(atIndex, draft.actions.length));
  const next = [...draft.actions];
  next.splice(i, 0, { nodeId: "", type, config: {} });
  return { ...draft, actions: rebuildBranchIds(next) };
}
export function addDecision(draft: RuleDraft): RuleDraft {
  const dec: DecisionNodeDraft = { nodeId: "", kind: "decision", branches: [{ branchId: "", conditions: {} as Conditions, steps: [] }] };
  return { ...draft, actions: rebuildBranchIds([...draft.actions, dec]) };
}
export function removeNode(draft: RuleDraft, nodeId: string): RuleDraft {
  return { ...draft, actions: rebuildBranchIds(filterNodeById(draft.actions, nodeId)) };
}
export function reorderAction(draft: RuleDraft, nodeId: string, dir: "up" | "down"): RuleDraft {
  const i = draft.actions.findIndex((a) => a.nodeId === nodeId);
  if (i < 0) return draft;
  const j = dir === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= draft.actions.length) return draft;
  const next = [...draft.actions];
  [next[i], next[j]] = [next[j], next[i]];
  return { ...draft, actions: rebuildBranchIds(next) };
}
export function setActionConfig(draft: RuleDraft, nodeId: string, patch: Record<string, unknown>): RuleDraft {
  return { ...draft, actions: mapNodeById(draft.actions, nodeId, (n) => (isDecisionDraft(n) ? n : { ...n, config: { ...n.config, ...patch } })) };
}
export function setActionType(draft: RuleDraft, nodeId: string, type: string): RuleDraft {
  return { ...draft, actions: mapNodeById(draft.actions, nodeId, (n) => (isDecisionDraft(n) ? n : { ...n, type, config: {} })) };
}
export function setActionDelay(draft: RuleDraft, nodeId: string, minutes: number): RuleDraft {
  return { ...draft, actions: mapNodeById(draft.actions, nodeId, (n) => (isDecisionDraft(n) ? n : { ...n, delayMinutes: minutes })) };
}
export function setDecisionLabel(draft: RuleDraft, nodeId: string, label: string): RuleDraft {
  return { ...draft, actions: mapNodeById(draft.actions, nodeId, (n) => (isDecisionDraft(n) ? { ...n, label } : n)) };
}
export function addBranch(draft: RuleDraft, decisionNodeId: string): RuleDraft {
  return {
    ...draft,
    actions: rebuildBranchIds(mapNodeById(draft.actions, decisionNodeId, (n) =>
      isDecisionDraft(n) ? { ...n, branches: [...n.branches, { branchId: "", conditions: {} as Conditions, steps: [] }] } : n,
    )),
  };
}
export function removeBranch(draft: RuleDraft, branchId: string): RuleDraft {
  const drop = (nodes: NodeDraft[]): NodeDraft[] =>
    nodes.map((n) => {
      if (isDecisionDraft(n)) {
        const kept = n.branches.filter((b) => b.branchId !== branchId);
        const branches = kept.length > 0 ? kept.map((b) => ({ ...b, steps: drop(b.steps) })) : [{ branchId: "", conditions: {} as Conditions, steps: [] }];
        return { ...n, branches, ...(n.else ? { else: drop(n.else) } : {}) };
      }
      return n;
    });
  return { ...draft, actions: rebuildBranchIds(drop(draft.actions)) };
}
export function setBranchConditions(draft: RuleDraft, branchId: string, conditions: Conditions): RuleDraft {
  return { ...draft, actions: mapBranchById(draft.actions, branchId, (b) => ({ ...b, conditions })) };
}
export function setBranchLabel(draft: RuleDraft, branchId: string, label: string): RuleDraft {
  return { ...draft, actions: mapBranchById(draft.actions, branchId, (b) => ({ ...b, label })) };
}
export function addActionToBranch(draft: RuleDraft, branchId: string, type: string): RuleDraft {
  return { ...draft, actions: rebuildBranchIds(mapBranchById(draft.actions, branchId, (b) => ({ ...b, steps: [...b.steps, { nodeId: "", type, config: {} }] }))) };
}
export function setElseEnabled(draft: RuleDraft, decisionNodeId: string, enabled: boolean): RuleDraft {
  const next = mapNodeById(draft.actions, decisionNodeId, (n) => {
    if (!isDecisionDraft(n)) return n;
    if (enabled) return n.else ? n : { ...n, else: [] };
    const { else: _drop, ...rest } = n;
    return rest as DecisionNodeDraft;
  });
  return { ...draft, actions: rebuildBranchIds(next) };
}
export function addActionToElse(draft: RuleDraft, decisionNodeId: string, type: string): RuleDraft {
  const next = mapNodeById(draft.actions, decisionNodeId, (n) =>
    isDecisionDraft(n) ? { ...n, else: [...(n.else ?? []), { nodeId: "", type, config: {} }] } : n,
  );
  return { ...draft, actions: rebuildBranchIds(next) };
}
/** @deprecated Use removeNode instead. Kept for backward compat with use-rule-draft.ts. */
export const removeAction = removeNode;

export function setTrigger(
  draft: RuleDraft,
  t: { triggerType: string; triggerConfig: Record<string, unknown> },
): RuleDraft {
  return { ...draft, triggerType: t.triggerType, triggerConfig: t.triggerConfig };
}

export function setConditions(draft: RuleDraft, conditions: Conditions): RuleDraft {
  return { ...draft, conditions };
}

export function setMeta(
  draft: RuleDraft,
  patch: Partial<Pick<RuleDraft, "name" | "description" | "priority" | "cooldownMinutes" | "isActive">>,
): RuleDraft {
  return { ...draft, ...patch };
}

// ─── Edición en el lienzo de /journey (J3) ────────────────────────────────────
// Posiciones del árbol («aquí, en esta lista, en este lugar») y esperas. Todo puro.

/** Una lista de pasos del árbol: la principal, una rama de decisión o su «si no». */
export type ListaRef =
  | { tipo: "raiz" }
  | { tipo: "rama"; branchId: string }
  | { tipo: "else"; nodeId: string };

/** Lugar donde entra un paso nuevo: `indice` = cuántos pasos quedan antes de él en esa lista. */
export interface PuntoDeInsercion { lista: ListaRef; indice: number }

/** Lo mínimo de una arista del lienzo que hace falta para saber dónde insertar. */
export interface AristaDeLienzo { source: string; target: string; data?: Record<string, unknown> }

const ESPERA = "~espera";
export const ID_ESPERA_DISPARADOR = "trigger~espera";
/** Id del nodo de espera que va antes de la acción `nodeId`. */
export const idEsperaDe = (nodeId: string) => `${nodeId}${ESPERA}`;
export const esIdDeEspera = (id: string) => id.endsWith(ESPERA);
/** `a1~espera` → `a1`; `trigger~espera` → `trigger`. */
export const baseDeEspera = (id: string) => (esIdDeEspera(id) ? id.slice(0, -ESPERA.length) : id);

function enLista(draft: RuleDraft, ref: ListaRef, fn: (l: NodeDraft[]) => NodeDraft[]): RuleDraft {
  if (ref.tipo === "raiz") return { ...draft, actions: fn(draft.actions) };
  const walk = (nodes: NodeDraft[]): NodeDraft[] =>
    nodes.map((n) => {
      if (!isDecisionDraft(n)) return n;
      if (ref.tipo === "else" && n.nodeId === ref.nodeId) return n.else ? { ...n, else: fn(n.else) } : n;
      return {
        ...n,
        branches: n.branches.map((b) =>
          ref.tipo === "rama" && b.branchId === ref.branchId ? { ...b, steps: fn(b.steps) } : { ...b, steps: walk(b.steps) },
        ),
        ...(n.else ? { else: walk(n.else) } : {}),
      };
    });
  return { ...draft, actions: walk(draft.actions) };
}

function buscarNodo(nodes: NodeDraft[], id: string): NodeDraft | undefined {
  for (const n of nodes) {
    if (n.nodeId === id) return n;
    if (isDecisionDraft(n)) {
      for (const b of n.branches) { const f = buscarNodo(b.steps, id); if (f) return f; }
      if (n.else) { const f = buscarNodo(n.else, id); if (f) return f; }
    }
  }
  return undefined;
}

/** Dónde está el nodo `nodeId` (su lista y su lugar en ella), o null. */
export function ubicarNodo(draft: RuleDraft, nodeId: string): PuntoDeInsercion | null {
  const buscar = (nodes: NodeDraft[], lista: ListaRef): PuntoDeInsercion | null => {
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (n.nodeId === nodeId) return { lista, indice: i };
      if (isDecisionDraft(n)) {
        for (const b of n.branches) {
          const r = buscar(b.steps, { tipo: "rama", branchId: b.branchId });
          if (r) return r;
        }
        if (n.else) {
          const r = buscar(n.else, { tipo: "else", nodeId: n.nodeId });
          if (r) return r;
        }
      }
    }
    return null;
  };
  return buscar(draft.actions, { tipo: "raiz" });
}

/** Mete `nodo` en ese lugar (el lugar se acota a la lista) y reasigna los ids. */
export function insertarNodoEn(draft: RuleDraft, punto: PuntoDeInsercion, nodo: NodeDraft): RuleDraft {
  const out = enLista(draft, punto.lista, (l) => {
    const i = Math.max(0, Math.min(punto.indice, l.length));
    const next = [...l];
    next.splice(i, 0, nodo);
    return next;
  });
  return { ...out, actions: rebuildBranchIds(out.actions) };
}

export function insertActionAt(draft: RuleDraft, punto: PuntoDeInsercion, type: string): RuleDraft {
  return insertarNodoEn(draft, punto, { nodeId: "", type, config: {} });
}

export function insertDecisionAt(draft: RuleDraft, punto: PuntoDeInsercion): RuleDraft {
  const dec: DecisionNodeDraft = { nodeId: "", kind: "decision", branches: [{ branchId: "", conditions: {} as Conditions, steps: [] }] };
  return insertarNodoEn(draft, punto, dec);
}

/** Id que tendrá el paso recién metido en `punto` (para dejarlo seleccionado). */
export function idDeNodoInsertado(punto: PuntoDeInsercion): string {
  if (punto.lista.tipo === "raiz") return `a${punto.indice}`;
  if (punto.lista.tipo === "rama") return `${punto.lista.branchId}.${punto.indice}`;
  return `${punto.lista.nodeId}.else.${punto.indice}`;
}

function listaDeBranchId(bid: string): ListaRef {
  return bid.endsWith(".else") ? { tipo: "else", nodeId: bid.slice(0, -".else".length) } : { tipo: "rama", branchId: bid };
}

/**
 * Lugar del árbol al que corresponde una línea del lienzo de edición (`draftToReadFlow` con `edicion`),
 * o null si en esa línea no se puede insertar (la que une una espera con su acción, o la que entra al «Si»).
 *  · sale de una decisión con rama → al principio de esa rama (o de su «si no»);
 *  · sale de un paso → justo después de él, en su misma lista;
 *  · sale del disparador / del «Si» → justo antes del paso al que llega (o al final si no hay pasos).
 */
export function puntoDeArista(draft: RuleDraft, e: AristaDeLienzo): PuntoDeInsercion | null {
  if (e.target === "condition" || e.target === ID_ESPERA_DISPARADOR) return null;
  if (esIdDeEspera(e.source) && baseDeEspera(e.source) === e.target) return null;
  const idOrigen = baseDeEspera(e.source);
  const nodoOrigen = buscarNodo(draft.actions, idOrigen);
  const bid = e.data?.branchId;
  if (nodoOrigen && isDecisionDraft(nodoOrigen) && typeof bid === "string") return { lista: listaDeBranchId(bid), indice: 0 };
  if (nodoOrigen && !isDecisionDraft(nodoOrigen)) {
    const u = ubicarNodo(draft, idOrigen);
    return u ? { lista: u.lista, indice: u.indice + 1 } : null;
  }
  // Origen = disparador o «Si»: antes del paso destino, o al final de una regla sin pasos.
  if (e.target === "fin") return { lista: { tipo: "raiz" }, indice: draft.actions.length };
  return ubicarNodo(draft, baseDeEspera(e.target));
}

/** A qué paso se le guarda una espera: el disparador (`"trigger"`) o una acción (su `nodeId`). */
export type ObjetivoDeEspera = string;

export type EsperaDeArista = { ok: true; objetivo: ObjetivoDeEspera } | { ok: false; motivo: string };

/**
 * La espera no es un nodo guardado: es `delayMinutes` del paso que viene después. Desde el disparador
 * (o su espera) se guarda en el disparador; si no, en la acción a la que llega la línea.
 */
export function esperaDeArista(draft: RuleDraft, e: AristaDeLienzo): EsperaDeArista {
  if (e.source === "trigger" || e.source === ID_ESPERA_DISPARADOR) return { ok: true, objetivo: "trigger" };
  const origen = buscarNodo(draft.actions, e.source);
  const bid = e.data?.branchId;
  if (origen && isDecisionDraft(origen) && typeof bid === "string") {
    // Línea de una rama: solo vale si llega al primer paso DE esa rama (si la rama está vacía, llega al
    // paso que sigue a la decisión y una espera ahí afectaría a todos los caminos).
    const u = ubicarNodo(draft, baseDeEspera(e.target));
    const ref = listaDeBranchId(bid);
    const mismaLista = !!u && u.lista.tipo === ref.tipo
      && (ref.tipo === "rama" ? (u.lista as typeof ref).branchId === ref.branchId : ref.tipo === "else" ? (u.lista as typeof ref).nodeId === ref.nodeId : true);
    if (!mismaLista) return { ok: false, motivo: "Esta rama está vacía. Agrega primero una acción aquí para poder esperar antes de ella." };
  }
  const nodo = buscarNodo(draft.actions, baseDeEspera(e.target));
  if (nodo && !isDecisionDraft(nodo)) return { ok: true, objetivo: nodo.nodeId };
  return { ok: false, motivo: "La espera se guarda en la acción que viene después. Agrega primero una acción aquí." };
}

/** Minutos de espera del disparador o de una acción (0 = sin espera). */
export function minutosDeEspera(draft: RuleDraft, objetivo: ObjetivoDeEspera): number {
  if (objetivo === "trigger") {
    const d = Number((draft.triggerConfig as Record<string, unknown> | undefined)?.delayMinutes ?? 0);
    return Number.isFinite(d) && d > 0 ? d : 0;
  }
  const n = buscarNodo(draft.actions, objetivo);
  if (!n || isDecisionDraft(n)) return 0;
  const m = n.delayMinutes ?? (typeof n.config?.delayMinutes === "number" ? (n.config.delayMinutes as number) : 0);
  return m > 0 ? m : 0;
}

/** Pone (minutos > 0) o quita (0) la espera. La de una acción se guarda en `delayMinutes` de la acción. */
export function setEspera(draft: RuleDraft, objetivo: ObjetivoDeEspera, minutos: number): RuleDraft {
  const m = Number.isFinite(minutos) ? Math.max(0, Math.round(minutos)) : 0;
  if (objetivo === "trigger") {
    const { delayMinutes: _viejo, ...resto } = (draft.triggerConfig ?? {}) as Record<string, unknown>;
    return { ...draft, triggerConfig: m > 0 ? { ...resto, delayMinutes: m } : resto };
  }
  return {
    ...draft,
    actions: mapNodeById(draft.actions, objetivo, (n) => {
      if (isDecisionDraft(n)) return n;
      // Una sola fuente de verdad: si la espera vivía en config (como la guarda el seed), se mueve.
      const { delayMinutes: _enConfig, ...config } = n.config ?? {};
      const { delayMinutes: _arriba, ...sinEspera } = n;
      return { ...sinEspera, config, ...(m > 0 ? { delayMinutes: m } : {}) };
    }),
  };
}

/** Al cambiar de disparador desde el panel se conserva la espera que ya tenía (no es parte del disparador elegido). */
export function conservarEsperaDeDisparador(
  actual: Record<string, unknown> | undefined,
  nuevo: Record<string, unknown>,
): Record<string, unknown> {
  const d = actual?.delayMinutes;
  if (typeof d === "number" && d > 0 && nuevo.delayMinutes === undefined) return { ...nuevo, delayMinutes: d };
  return nuevo;
}

/**
 * Draft mínimo VÁLIDO para una regla nueva (E4 #6). Antes nacía con nombre vacío (la API exige
 * >= 3 caracteres), trigger EVENT sin eventType y CHANGE_STAGE sin etapa, así que el primer
 * "Guardar" siempre fallaba con "Datos inválidos". Ahora: nombre "Nueva regla", disparador del
 * catálogo (lead.captured) y una acción con config completa (mover a la primera etapa del pipeline).
 * Nace inactiva: no dispara nada hasta que el usuario la active.
 */
export function newRuleDraft(): RuleDraft {
  const trigger = armarDisparador("lead.captured", "");
  return {
    id: undefined,
    name: "Nueva regla",
    description: null,
    triggerType: trigger.triggerType,
    triggerConfig: trigger.triggerConfig,
    conditions: {} as Conditions,
    actions: [{ nodeId: "a0", type: "CHANGE_STAGE", config: { toStage: PIPELINE_STAGES[0].code } }],
    cooldownMinutes: null,
    priority: 100,
    isActive: false,
  };
}

/**
 * Convierte un payload de regla (acciones planas o con ramas, como lo arma el constructor de
 * Configuracion) en draft del lienzo. Sin id => regla nueva (el draft no lleva id).
 */
export function payloadToDraft(p: RulePayload): RuleDraft {
  const d = ruleToDraft({ ...p, id: p.id ?? "" });
  if (!p.id) delete d.id;
  return d;
}

// ─────────────────────────────────────────────────────────────────────────────

export function draftToRulePayload(draft: RuleDraft): RulePayload {
  const payload: RulePayload = {
    name: draft.name,
    description: draft.description,
    triggerType: draft.triggerType,
    triggerConfig: draft.triggerConfig,
    conditions: draft.conditions,
    actions: draft.actions.map(draftToNode),
    cooldownMinutes: draft.cooldownMinutes,
    priority: draft.priority,
    isActive: draft.isActive,
  };
  if (draft.id) payload.id = draft.id;
  return payload;
}
