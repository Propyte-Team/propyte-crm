// Acomodo automático del flujo de una regla (J2). Puro: sin React ni React Flow.
// Toma los nodos/aristas de un Flow y devuelve los mismos con `position` calculada (dagre, de arriba
// hacia abajo). El acomodo no se guarda en ningún lado: siempre se calcula.
import dagre from "@dagrejs/dagre";
import type { Flow, RFNode } from "./flow-adapter";

export interface Tamano { width: number; height: number }

/** Tamaño de cada tipo de nodo. Debe coincidir con lo que dibuja el lienzo de lectura. */
export const TAMANOS_NODO: Record<string, Tamano> = {
  trigger: { width: 280, height: 84 },
  condition: { width: 280, height: 84 },
  action: { width: 280, height: 84 },
  stage: { width: 280, height: 84 },
  wait: { width: 200, height: 36 },
  decision: { width: 280, height: 60 },
  empty: { width: 200, height: 36 },
};
export const TAMANO_POR_DEFECTO: Tamano = { width: 280, height: 84 };

export interface OpcionesLayout {
  /** Tamaños por tipo; se mezclan sobre `TAMANOS_NODO`. */
  tamanos?: Record<string, Tamano>;
  /** Separación horizontal entre nodos de un mismo nivel. */
  separacionX?: number;
  /** Separación vertical entre niveles. */
  separacionY?: number;
}

export function layoutFlow(flow: Flow, opts: OpcionesLayout = {}): Flow {
  if (flow.nodes.length === 0) return { nodes: [], edges: flow.edges.slice() };
  const tamanos = { ...TAMANOS_NODO, ...(opts.tamanos ?? {}) };
  const tamanoDe = (n: RFNode): Tamano => tamanos[n.type] ?? TAMANO_POR_DEFECTO;

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: opts.separacionX ?? 48, ranksep: opts.separacionY ?? 64, marginx: 0, marginy: 0 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of flow.nodes) g.setNode(n.id, { ...tamanoDe(n) });
  const ids = new Set(flow.nodes.map((n) => n.id));
  for (const e of flow.edges) {
    if (ids.has(e.source) && ids.has(e.target)) g.setEdge(e.source, e.target);
  }
  dagre.layout(g);

  const nodes = flow.nodes.map((n) => {
    const p = g.node(n.id);
    const t = tamanoDe(n);
    // dagre entrega el centro; React Flow quiere la esquina superior izquierda.
    return { ...n, position: { x: Math.round(p.x - t.width / 2), y: Math.round(p.y - t.height / 2) } };
  });
  return { nodes, edges: flow.edges.slice() };
}
