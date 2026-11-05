// Tipos planos de un flujo de React Flow ({nodes, edges}) y utilidades de posición. Sin React Flow
// aquí (solo tipos planos) → testeable en Node.

export interface RFNode { id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown> }
export interface RFEdge { id: string; source: string; target: string; data?: Record<string, unknown> }
export interface Flow { nodes: RFNode[]; edges: RFEdge[] }
export type Positions = Record<string, { x: number; y: number }>;

/** Aplica posiciones guardadas por nodo; los no guardados conservan el auto-layout. */
export function applyPositions(nodes: RFNode[], positions: Positions): RFNode[] {
  return nodes.map((n) => (positions[n.id] ? { ...n, position: positions[n.id] } : n));
}
