"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow, Background, Controls, MiniMap, useNodesState, useEdgesState,
  type Node, type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { LIFECYCLE_COLORS } from "@/lib/constants";
import { buildGeneralView, buildTargetedView, extractCampaigns, type RuleLite, type PlanLite } from "@/lib/journey/journey-map";
import { generalToFlow, targetedToFlow, applyPositions, type Positions } from "@/lib/journey/flow-adapter";

type Mode = "general" | "targeted";

function nodeStyle(type: string, data: Record<string, unknown>): React.CSSProperties {
  const dim = data.isActive === false ? 0.5 : 1;
  if (type === "stage") return { background: (LIFECYCLE_COLORS[String(data.stage)] ?? "#6B7280"), color: "#fff", border: "none", borderRadius: 8, padding: 8, fontSize: 12, fontWeight: 600, opacity: dim };
  if (type === "trigger") return { background: "#2563eb", color: "#fff", borderRadius: 8, padding: 8, fontSize: 12, opacity: dim };
  if (type === "cadence") return { border: "1px dashed #9ca3af", borderRadius: 8, padding: 8, fontSize: 12, background: "#fff", opacity: dim };
  if (type === "condition") return { border: "1px dashed #9ca3af", borderRadius: 8, padding: 8, fontSize: 12, opacity: dim };
  return { border: "1px solid #d1d5db", borderRadius: 8, padding: 8, fontSize: 12, background: "#fff", opacity: dim };
}

export function JourneyMapView() {
  const [rules, setRules] = useState<RuleLite[]>([]);
  const [plans, setPlans] = useState<PlanLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<Mode>("general");
  const [campaign, setCampaign] = useState("");
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scope = mode === "general" ? "general" : `targeted:${campaign}`;

  useEffect(() => {
    fetch("/api/admin/automation").then((r) => r.json()).then((j) => {
      const d = j.data ?? j;
      setRules((d.rules ?? []) as RuleLite[]);
      setPlans((d.plans ?? []) as PlanLite[]);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const campaigns = useMemo(() => extractCampaigns(rules), [rules]);

  // Reconstruir el flujo + aplicar layout guardado cuando cambian datos/scope
  useEffect(() => {
    const flow = mode === "general"
      ? generalToFlow(buildGeneralView(rules, plans))
      : campaign ? targetedToFlow(buildTargetedView(rules, plans, { campaign })) : { nodes: [], edges: [] };
    // cargar posiciones guardadas (best-effort: si la tabla no existe aún, degrada a auto-layout)
    fetch(`/api/admin/journey/layout?scope=${encodeURIComponent(scope)}`)
      .then((r) => r.ok ? r.json() : { positions: {} })
      .catch(() => ({ positions: {} }))
      .then((j) => {
        const positioned = applyPositions(flow.nodes, (j.positions ?? {}) as Positions);
        setNodes(positioned as unknown as Node[]);
        setEdges(flow.edges as unknown as Edge[]);
      });
  }, [rules, plans, mode, campaign, scope, setNodes, setEdges]);

  const persist = useCallback((current: Node[]) => {
    const positions: Positions = {};
    for (const n of current) positions[n.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) };
    fetch("/api/admin/journey/layout", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope, positions }),
    }).catch(() => {});
  }, [scope]);

  const onNodeDragStop = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => setNodes((nds) => { persist(nds); return nds; }), 600);
  }, [persist, setNodes]);

  const typedNodes = useMemo(() => nodes.map((n) => ({
    ...n, data: { label: (n.data as { label?: string }).label }, style: nodeStyle(n.type ?? "action", n.data as Record<string, unknown>),
  })), [nodes]);

  if (loading) return <div className="p-8 text-sm text-neutral-500">Cargando lienzo…</div>;
  if (!rules.length && !plans.length) return <div className="p-8 text-sm text-neutral-500">Sin reglas ni cadencias configuradas. Créalas en Configuración → Automatización.</div>;

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      <header className="flex items-center gap-3 border-b border-neutral-200 px-6 py-3 dark:border-neutral-800">
        <h1 className="text-lg font-semibold tracking-tight">Mapa de Journey</h1>
        <div className="ml-auto flex items-center gap-2 text-sm">
          <div className="inline-flex rounded-md border border-neutral-300 p-0.5">
            <button onClick={() => setMode("general")} className={`px-3 py-1 rounded text-xs font-medium transition-colors ${mode === "general" ? "bg-neutral-900 text-white" : "text-neutral-600"}`}>General</button>
            <button onClick={() => setMode("targeted")} className={`px-3 py-1 rounded text-xs font-medium transition-colors ${mode === "targeted" ? "bg-neutral-900 text-white" : "text-neutral-600"}`}>Dirigida</button>
          </div>
          {mode === "targeted" && (
            <select value={campaign} onChange={(e) => setCampaign(e.target.value)} className="rounded-md border border-neutral-300 px-2 py-1 text-xs bg-transparent">
              <option value="">— elige campaña —</option>
              {campaigns.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
        </div>
      </header>
      <div className="flex-1">
        <ReactFlow
          nodes={typedNodes} edges={edges}
          onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
          onNodeDragStop={onNodeDragStop}
          nodesConnectable={false} fitView proOptions={{ hideAttribution: true }}
        >
          <Background />
          <Controls />
          <MiniMap pannable zoomable />
        </ReactFlow>
      </div>
      <p className="border-t border-neutral-200 px-6 py-1.5 text-xs text-neutral-400 dark:border-neutral-800">Solo lectura. Mueve los nodos para acomodar; el acomodo se guarda. Edita reglas/cadencias en Configuración &rarr; Automatización.</p>
    </div>
  );
}
