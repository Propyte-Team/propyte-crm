"use client";
// Piezas compartidas del lienzo (mapa de solo lectura y editor de una regla): tipos de nodo,
// estilos, etiquetas, re-encuadre y decoracion con metricas. Sin estado propio.
import { useEffect } from "react";
import { Handle, Position, useReactFlow, type Edge, type EdgeTypes, type Node, type NodeProps, type NodeTypes } from "@xyflow/react";
import { LIFECYCLE_COLORS, STAGE_COLORS, STAGE_LABELS } from "@/lib/constants";
import { labelFor } from "@/lib/journey/node-catalog";
import { describeAction } from "@/lib/workflows/action-catalog";
import { describeConditions } from "@/lib/workflows/condition-catalog";
import type { NodeMetrics } from "@/lib/journey/node-metrics";
import { InsertEdge } from "./insert-edge";

// Referencia estable a nivel de modulo para que React Flow no remonte nodos/aristas en cada render.
export const EDGE_TYPES: EdgeTypes = { insert: InsertEdge as EdgeTypes[string] };

function DecisionNode({ data }: NodeProps) {
  const d = data as Record<string, unknown>;
  const label = d.label as string | undefined;
  const metricVolume = d.metricVolume as number | undefined;
  return (
    // Contenedor SIN fondo ni borde (E4 #10); el resalte de seleccion lo aplica nodeStyle().
    <div style={{ width: 80, height: 80, display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
      <div style={{ width: 80, height: 80, transform: "rotate(45deg)", background: "#7c3aed", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Handle type="target" position={Position.Top} style={{ transform: "rotate(-45deg)", background: "#555" }} />
        <span style={{ transform: "rotate(-45deg)", color: "#fff", fontSize: 10, fontWeight: 600, textAlign: "center", padding: "0 4px", maxWidth: 70, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {label ?? "Decisión"}
        </span>
        <Handle type="source" position={Position.Bottom} style={{ transform: "rotate(-45deg)", background: "#555" }} />
      </div>
      {typeof metricVolume === "number" && (
        <span style={{ position: "absolute", top: -8, right: -8, background: "#0a0a0a", color: "#fff", borderRadius: 10, fontSize: 11, padding: "1px 7px", pointerEvents: "none", zIndex: 10 }}>
          {metricVolume}
        </span>
      )}
    </div>
  );
}

function BasicNode({ data }: NodeProps) {
  const label = (data as Record<string, unknown>).label as string | undefined;
  return (
    <>
      <Handle type="target" position={Position.Top} />
      {label}
      <Handle type="source" position={Position.Bottom} />
    </>
  );
}

export const NODE_TYPES: NodeTypes = {
  decision: DecisionNode as NodeTypes[string],
  rule: BasicNode as NodeTypes[string],
  cadence: BasicNode as NodeTypes[string],
  stage: BasicNode as NodeTypes[string],
  trigger: BasicNode as NodeTypes[string],
  condition: BasicNode as NodeTypes[string],
  action: BasicNode as NodeTypes[string],
};

/** Re-encuadra el lienzo cuando cambia `token`. Debe vivir DENTRO de <ReactFlow>. */
export function FitOnChange({ token }: { token: string }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    const t = setTimeout(() => { fitView({ padding: 0.15, duration: 200 }); }, 60);
    return () => clearTimeout(t);
  }, [token, fitView]);
  return null;
}

export function nodeStyle(type: string, data: Record<string, unknown>, selected: boolean): React.CSSProperties {
  const dim = data.isActive === false ? 0.5 : 1;
  const sel = selected ? { outline: "2px solid #0a0a0a", outlineOffset: 2 } : {};
  if (type === "decision") return { opacity: dim, ...sel };
  if (type === "stage") {
    const lifecycle = String((data.stage as string | undefined) ?? "");
    const pipeline = String((data.config as Record<string, unknown> | undefined)?.toStage ?? "");
    const bg = LIFECYCLE_COLORS[lifecycle] ?? STAGE_COLORS[pipeline] ?? STAGE_COLORS[lifecycle] ?? "#6B7280";
    return { background: bg, color: "#fff", border: "none", borderRadius: 8, padding: 8, fontSize: 12, fontWeight: 600, opacity: dim, ...sel };
  }
  if (type === "trigger") return { background: "#2563eb", color: "#fff", borderRadius: 8, padding: 8, fontSize: 12, opacity: dim, ...sel };
  if (type === "cadence") return { border: "1px dashed #9ca3af", borderRadius: 8, padding: 8, fontSize: 12, background: "#fff", opacity: dim, ...sel };
  if (type === "condition") return { border: "1px dashed #9ca3af", borderRadius: 8, padding: 8, fontSize: 12, opacity: dim, ...sel };
  return { border: "1px solid #d1d5db", borderRadius: 8, padding: 8, fontSize: 12, background: "#fff", opacity: dim, ...sel };
}

export function nodeLabel(type: string, data: Record<string, unknown>): string {
  let label: string;
  if (type === "stage") {
    label = typeof data.label === "string" && data.label
      ? data.label
      : (() => { const s = String((data.config as Record<string, unknown> | undefined)?.toStage ?? ""); return s ? `Etapa → ${STAGE_LABELS[s] ?? s}` : "Etapa"; })();
  } else if (data.actionType) {
    // Frase del catálogo de E3 (sin emoji, en español), igual que la lista y el inspector.
    label = describeAction({ type: String(data.actionType), config: (data.config ?? {}) as Record<string, unknown> });
  } else if (type === "condition") {
    label = data.conditions ? `Si ${describeConditions(data.conditions)}` : "Condición";
  } else if (typeof data.label === "string" && data.label) {
    label = data.label;
  } else {
    label = labelFor(type) || type;
  }
  return data.isSlaBreach ? `⏱️ ${label}` : label;
}

/** Nodos listos para React Flow: etiqueta, estilo, seleccion y volumen por nodo si hay metricas. */
export function decorateNodes(nodes: Node[], opts: { selectedId: string | null; metrics: NodeMetrics | null }): Node[] {
  return nodes.map((n) => {
    const d = n.data as Record<string, unknown>;
    const baseLabel = nodeLabel(n.type ?? "action", d);
    const vol = opts.metrics ? (opts.metrics.nodeVolumes[n.id] ?? 0) : undefined;
    const label = vol !== undefined && n.type !== "decision" ? `${vol} · ${baseLabel}` : baseLabel;
    const data: Record<string, unknown> = { label };
    if (n.type === "decision" && vol !== undefined) data.metricVolume = vol;
    if (d.planId) data.planId = d.planId;
    if (d.isSlaBreach) data.isSlaBreach = d.isSlaBreach;
    return { ...n, data, style: nodeStyle(n.type ?? "action", d, n.id === opts.selectedId) };
  });
}

/** Etiqueta de arista con el reparto por rama ("45% · 12") cuando hay metricas. */
export function edgeLabel(e: { data?: unknown }, metrics: NodeMetrics | null): string | undefined {
  const eData = e.data as { label?: string; branchId?: string } | undefined;
  const split = metrics && eData?.branchId ? metrics.branchSplits[eData.branchId] : undefined;
  const metricText = split ? `${split.pct}% · ${split.count}` : undefined;
  return metricText ? (eData?.label ? `${eData.label} · ${metricText}` : metricText) : eData?.label;
}

export type { Edge };
