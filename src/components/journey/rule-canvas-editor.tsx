"use client";
// Lienzo editable de UNA regla (vista avanzada de ramas). Lo usa el constructor de Configuracion
// (modal) y no depende de /journey. Recibe `ruleId` (carga la regla) o `initialDraft` (por ejemplo
// una regla lineal convertida a flujo con ramas) y avisa con onSaved(regla) / onCancel().
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ReactFlow, Background, Controls, MiniMap, useNodesState, useEdgesState, type Node, type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { applyPositions } from "@/lib/journey/flow-adapter";
import { draftToFlow, type RuleDraft, type RuleRow } from "@/lib/journey/rule-draft";
import { computeNodeMetrics, type RawMetrics, type NodeMetrics } from "@/lib/journey/node-metrics";
import { useRuleDraft } from "./use-rule-draft";
import { RuleInspectorPanel } from "./rule-inspector-panel";
import { NodePalette } from "./node-palette";
import { EDGE_TYPES, NODE_TYPES, FitOnChange, decorateNodes, edgeLabel } from "./flow-nodes";

interface Props {
  ruleId?: string;
  initialDraft?: RuleDraft;
  onSaved: (rule: RuleRow) => void;
  onCancel: () => void;
}

export function RuleCanvasEditor({ ruleId, initialDraft, onSaved, onCancel }: Props) {
  const { draft, isDirty, saving, error, fieldErrors, load, loadDraft, lastSaved, ops, save } = useRuleDraft();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [paletteAt, setPaletteAt] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Posiciones arrastradas durante la sesion (nodeId -> posicion): el auto-layout no las deshace.
  const dragPos = useRef<Record<string, { x: number; y: number }>>({});

  const [metricsOn, setMetricsOn] = useState(false);
  const [metricsWindow, setMetricsWindow] = useState<"7" | "30" | "90" | "all">("30");
  const [metrics, setMetrics] = useState<NodeMetrics | null>(null);
  const [metricsTotal, setMetricsTotal] = useState(0);

  // Carga inicial: draft entregado o regla por id.
  useEffect(() => {
    if (initialDraft) { loadDraft(initialDraft); return; }
    if (!ruleId) return;
    let cancel = false;
    fetch("/api/admin/automation").then((r) => r.json()).then((j) => {
      if (cancel) return;
      const d = j.data ?? j;
      const r = ((d.rules ?? []) as RuleRow[]).find((x) => x.id === ruleId);
      if (r) load(r); else setLoadError("No encontramos esa regla.");
    }).catch(() => { if (!cancel) setLoadError("No se pudo cargar la regla."); });
    return () => { cancel = true; };
    // Solo al montar: el draft vive en el hook desde ahi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const draftId = draft?.id;
  useEffect(() => {
    if (!metricsOn || !draftId) { setMetrics(null); return; }
    let cancel = false;
    fetch(`/api/admin/journey/metrics?ruleId=${encodeURIComponent(draftId)}&window=${metricsWindow}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((raw: RawMetrics | null) => {
        if (cancel || !raw || !draft) return;
        setMetricsTotal(raw.total ?? 0);
        setMetrics(computeNodeMetrics(draft, raw));
      })
      .catch(() => { if (!cancel) setMetrics(null); });
    return () => { cancel = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metricsOn, metricsWindow, draftId, draft]);

  // El lienzo se deriva del draft (auto-layout, con ⊕ para insertar acciones).
  useEffect(() => {
    if (!draft) return;
    const flow = draftToFlow(draft);
    const editEdges = flow.edges.map((e) => {
      const label = edgeLabel(e, metrics);
      const m = /^a(\d+)$/.exec(e.target);
      return m
        ? { ...e, type: "insert", label, data: { onInsert: () => setPaletteAt(Number(m[1])), label } }
        : { ...e, label };
    });
    setNodes(applyPositions(flow.nodes, dragPos.current) as unknown as Node[]);
    setEdges(editEdges as unknown as Edge[]);
  }, [draft, setNodes, setEdges, metrics]);

  const onNodeDragStop = useCallback((_e: unknown, node: Node, dragged?: Node[]) => {
    for (const n of dragged && dragged.length ? dragged : [node]) dragPos.current[n.id] = { x: n.position.x, y: n.position.y };
  }, []);

  const onSave = useCallback(async () => {
    if (draft?.isActive && !window.confirm("Esta regla está activa: los cambios aplican a disparos nuevos. ¿Guardar?")) return;
    const ok = await save();
    if (ok && lastSaved.current) onSaved(lastSaved.current);
  }, [draft, save, lastSaved, onSaved]);

  const onCancelClick = useCallback(() => {
    if (isDirty && !window.confirm("Hay cambios sin guardar. ¿Salir de la vista avanzada?")) return;
    onCancel();
  }, [isDirty, onCancel]);

  if (loadError) {
    return (
      <div className="space-y-3 p-4 text-sm">
        <p className="text-red-700">{loadError}</p>
        <button type="button" className="btn-secondary text-[13px]" onClick={onCancel}>Volver</button>
      </div>
    );
  }
  if (!draft) return <div className="p-6 text-sm text-neutral-500">Cargando lienzo…</div>;

  const fieldMsgs = Object.entries(fieldErrors);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-neutral-200 px-4 py-2 dark:border-neutral-800">
        <h2 className="mr-auto truncate text-sm font-semibold">Vista avanzada · {draft.name || "Regla sin nombre"}</h2>
        {isDirty && <span className="text-xs text-amber-600">● sin guardar</span>}
        <div className="relative">
          <button type="button" onClick={() => setPaletteAt(draft.actions.length)} className="rounded-md border border-neutral-300 px-3 py-1 text-xs font-medium">+ Añadir</button>
          {paletteAt !== null && (
            <NodePalette
              onPick={(type) => { ops.insertAction(type, paletteAt); setPaletteAt(null); }}
              onClose={() => setPaletteAt(null)}
              onAddDecision={() => { ops.addDecision(); setPaletteAt(null); }}
            />
          )}
        </div>
        {draft.id && (
          <>
            <button type="button" onClick={() => setMetricsOn((v) => !v)} className={`rounded-md px-3 py-1 text-xs font-medium ${metricsOn ? "bg-neutral-900 text-white" : "border border-neutral-300"}`}>● Métricas</button>
            {metricsOn && (
              <>
                <select className="rounded-md border border-neutral-300 bg-transparent px-2 py-1 text-xs" value={metricsWindow} onChange={(e) => setMetricsWindow(e.target.value as "7" | "30" | "90" | "all")}>
                  <option value="7">7d</option><option value="30">30d</option><option value="90">90d</option><option value="all">Todo</option>
                </select>
                <span className="text-xs text-neutral-500">{metricsTotal} contactos · {metricsWindow === "all" ? "histórico" : `${metricsWindow}d`}</span>
              </>
            )}
          </>
        )}
        <button type="button" onClick={onCancelClick} disabled={saving} className="rounded-md border border-neutral-300 px-3 py-1 text-xs font-medium">Cancelar</button>
        <button type="button" onClick={onSave} disabled={!isDirty || saving} className="rounded-md bg-neutral-900 px-3 py-1 text-xs font-medium text-white disabled:opacity-40">{saving ? "Guardando…" : "Guardar"}</button>
      </header>
      {(error || fieldMsgs.length > 0) && (
        <div role="alert" className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">
          {error && <p>{error}</p>}
          {fieldMsgs.length > 0 && (
            <ul className="list-disc pl-4">{fieldMsgs.map(([k, m]) => <li key={k}>{k}: {m}</li>)}</ul>
          )}
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <div className="relative flex-1">
          <ReactFlow
            nodes={decorateNodes(nodes, { selectedId, metrics })} edges={edges}
            onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
            onNodeDragStop={onNodeDragStop}
            onNodeClick={(_e, n) => setSelectedId(n.id)}
            onPaneClick={() => setSelectedId(null)}
            nodesConnectable={false} deleteKeyCode={null} fitView proOptions={{ hideAttribution: true }}
            edgeTypes={EDGE_TYPES} nodeTypes={NODE_TYPES}
          >
            <Background />
            <Controls />
            <MiniMap pannable zoomable />
            <FitOnChange token={`${draft.id ?? "new"}|${nodes.length}`} />
          </ReactFlow>
        </div>
        <div className="w-80 shrink-0 overflow-y-auto border-l border-neutral-200 p-4 dark:border-neutral-800">
          <RuleInspectorPanel draft={draft} selectedId={selectedId} ops={ops} />
        </div>
      </div>
      <p className="border-t border-neutral-200 px-4 py-1.5 text-xs text-neutral-400 dark:border-neutral-800">
        Selecciona un nodo para ver sus campos. Usa ⊕ para insertar acciones. Guardar escribe al motor.
      </p>
    </div>
  );
}
