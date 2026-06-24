// Adaptador puro: vistas derivadas (journey-map.ts) → {nodes,edges} de React Flow.
// Sin importar React Flow aquí (solo tipos planos) → testeable en Node.
import type { GeneralView, TargetedView } from "./journey-map";
import { LIFECYCLE_LABELS } from "@/lib/constants";

export interface RFNode { id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown> }
export interface RFEdge { id: string; source: string; target: string }
export interface Flow { nodes: RFNode[]; edges: RFEdge[] }
export type Positions = Record<string, { x: number; y: number }>;

const LANE_W = 240;   // ancho por carril
const ROW_H = 90;     // alto por fila dentro del carril
const HEADER_Y = 0;

export function generalToFlow(view: GeneralView): Flow {
  const nodes: RFNode[] = [];
  const edges: RFEdge[] = [];
  view.lanes.forEach((lane, li) => {
    const x = li * LANE_W;
    nodes.push({
      id: `stage:${lane.stage}`, type: "stage", position: { x, y: HEADER_Y },
      data: { label: LIFECYCLE_LABELS[lane.stage] ?? "General / Sin etapa", stage: lane.stage },
    });
    let row = 1;
    for (const r of lane.rules) {
      nodes.push({ id: `rule:${r.id}`, type: "rule", position: { x, y: row * ROW_H },
        data: { label: r.name, isActive: r.isActive, triggerType: r.triggerType } });
      row++;
    }
    for (const c of lane.cadences) {
      nodes.push({ id: `plan:${c.id}`, type: "cadence", position: { x, y: row * ROW_H },
        data: { label: c.name, isActive: c.isActive, stepCount: c.stepCount } });
      row++;
    }
    if (li > 0) {
      const prev = view.lanes[li - 1];
      edges.push({ id: `adv:${prev.stage}->${lane.stage}`, source: `stage:${prev.stage}`, target: `stage:${lane.stage}` });
    }
  });
  return { nodes, edges };
}

export function targetedToFlow(view: TargetedView): Flow {
  const nodes: RFNode[] = [];
  const edges: RFEdge[] = [];
  view.flows.forEach((flow, fi) => {
    let prevId: string | null = null;
    flow.forEach((node, ni) => {
      const id = `f${fi}:${node.kind}:${ni}`;
      nodes.push({ id, type: node.kind, position: { x: ni * LANE_W, y: fi * (ROW_H * 1.6) },
        data: { label: node.label } });
      if (prevId) edges.push({ id: `${prevId}->${id}`, source: prevId, target: id });
      prevId = id;
    });
  });
  return { nodes, edges };
}

/** Aplica posiciones guardadas por nodo; los no guardados conservan el auto-layout. */
export function applyPositions(nodes: RFNode[], positions: Positions): RFNode[] {
  return nodes.map((n) => (positions[n.id] ? { ...n, position: positions[n.id] } : n));
}
