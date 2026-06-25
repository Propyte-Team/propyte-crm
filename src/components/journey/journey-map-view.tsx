"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ReactFlow, Background, Controls, MiniMap, useNodesState, useEdgesState,
  type Node, type Edge, type EdgeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { STAGE_COLORS, STAGE_LABELS } from "@/lib/constants";
import { buildGeneralView, buildTargetedView, extractCampaigns, type RuleLite, type PlanLite } from "@/lib/journey/journey-map";
import { generalToFlow, targetedToFlow, applyPositions, type Positions } from "@/lib/journey/flow-adapter";
import { draftToFlow, type RuleRow } from "@/lib/journey/rule-draft";
import { labelFor, summaryFor } from "@/lib/journey/node-catalog";
import { useRuleDraft } from "./use-rule-draft";
import { RuleInspectorPanel } from "./rule-inspector-panel";
import { NodePalette } from "./node-palette";
import { InsertEdge } from "./insert-edge";

type Mode = "general" | "targeted";

// Stable module-scope reference so ReactFlow doesn't remount on render
const EDGE_TYPES: EdgeTypes = { insert: InsertEdge as EdgeTypes[string] };

function nodeStyle(type: string, data: Record<string, unknown>, selected: boolean): React.CSSProperties {
  const dim = data.isActive === false ? 0.5 : 1;
  const sel = selected ? { outline: "2px solid #0a0a0a", outlineOffset: 2 } : {};
  if (type === "stage") {
    const stageCode = String((data.config as Record<string, unknown> | undefined)?.toStage ?? "");
    const bg = STAGE_COLORS[stageCode] ?? "#6B7280";
    return { background: bg, color: "#fff", border: "none", borderRadius: 8, padding: 8, fontSize: 12, fontWeight: 600, opacity: dim, ...sel };
  }
  if (type === "trigger") return { background: "#2563eb", color: "#fff", borderRadius: 8, padding: 8, fontSize: 12, opacity: dim, ...sel };
  if (type === "cadence") return { border: "1px dashed #9ca3af", borderRadius: 8, padding: 8, fontSize: 12, background: "#fff", opacity: dim, ...sel };
  if (type === "condition") return { border: "1px dashed #9ca3af", borderRadius: 8, padding: 8, fontSize: 12, opacity: dim, ...sel };
  return { border: "1px solid #d1d5db", borderRadius: 8, padding: 8, fontSize: 12, background: "#fff", opacity: dim, ...sel };
}

function nodeLabel(type: string, data: Record<string, unknown>): string {
  if (type === "stage") {
    const s = String((data.config as Record<string, unknown> | undefined)?.toStage ?? "");
    return s ? `Etapa → ${STAGE_LABELS[s] ?? s}` : "Etapa";
  }
  if (data.actionType) {
    return summaryFor(String(data.actionType), (data.config ?? {}) as Record<string, unknown>);
  }
  if (typeof data.label === "string" && data.label) return data.label;
  return labelFor(type) || type;
}

export function JourneyMapView() {
  const router = useRouter();
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [plans, setPlans] = useState<PlanLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<Mode>("general");
  const [campaign, setCampaign] = useState("");
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { draft, isDirty, saving, error, load, startNew, ops, save, discard } = useRuleDraft();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [paletteAt, setPaletteAt] = useState<number | null>(null);
  const editing = draft !== null;

  const scope = mode === "general" ? "general" : `targeted:${campaign}`;

  const refreshData = useCallback(() => {
    return fetch("/api/admin/automation").then((r) => r.json()).then((j) => {
      const d = j.data ?? j;
      setRules((d.rules ?? []) as RuleRow[]);
      setPlans((d.plans ?? []) as PlanLite[]);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  useEffect(() => { refreshData(); }, [refreshData]);

  const campaigns = useMemo(() => extractCampaigns(rules as unknown as RuleLite[]), [rules]);

  // Salir de edición si se vuelve a General (solo Dirigida es editable).
  useEffect(() => { if (mode === "general" && draft) { discard(); setSelectedId(null); } }, [mode, draft, discard]);

  // READ-ONLY: reconstruir flujo + layout guardado cuando cambian datos/scope (no en edición).
  useEffect(() => {
    if (editing) return;
    const flow = mode === "general"
      ? generalToFlow(buildGeneralView(rules as unknown as RuleLite[], plans))
      : campaign ? targetedToFlow(buildTargetedView(rules as unknown as RuleLite[], plans, { campaign })) : { nodes: [], edges: [] };
    fetch(`/api/admin/journey/layout?scope=${encodeURIComponent(scope)}`)
      .then((r) => r.ok ? r.json() : { positions: {} })
      .catch(() => ({ positions: {} }))
      .then((j) => {
        const positioned = applyPositions(flow.nodes, (j.positions ?? {}) as Positions);
        setNodes(positioned as unknown as Node[]);
        setEdges(flow.edges as unknown as Edge[]);
      });
  }, [rules, plans, mode, campaign, scope, editing, setNodes, setEdges]);

  // EDICIÓN: el lienzo se deriva del draft (auto-layout; con ⊕ insert edges).
  useEffect(() => {
    if (!draft) return;
    const flow = draftToFlow(draft);
    const editEdges = flow.edges.map((e) => {
      const m = /^a(\d+)$/.exec(e.target);
      return m
        ? { ...e, type: "insert", data: { onInsert: () => setPaletteAt(Number(m[1])) } }
        : e;
    });
    setNodes(flow.nodes as unknown as Node[]);
    setEdges(editEdges as unknown as Edge[]);
  }, [draft, setNodes, setEdges]);

  const persist = useCallback((current: Node[]) => {
    const positions: Positions = {};
    for (const n of current) positions[n.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) };
    fetch("/api/admin/journey/layout", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope, positions }),
    }).catch(() => {});
  }, [scope]);

  const onNodeDragStop = useCallback(() => {
    if (editing) return; // en edición no persistimos layout
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => setNodes((nds) => { persist(nds); return nds; }), 600);
  }, [persist, setNodes, editing]);

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  const onNodeClick = useCallback((_e: React.MouseEvent, node: Node) => {
    if (editing) { setSelectedId(node.id); return; }
    if (node.type === "cadence") router.push("/configuracion");
  }, [editing, router]);

  const typedNodes = useMemo(() => nodes.map((n) => {
    const d = n.data as Record<string, unknown>;
    return { ...n, data: { label: nodeLabel(n.type ?? "action", d) }, style: nodeStyle(n.type ?? "action", d, n.id === selectedId) };
  }), [nodes, selectedId]);

  const onSelectRule = useCallback((id: string) => {
    const r = rules.find((x) => x.id === id);
    if (r) { load(r); setSelectedId(null); }
  }, [rules, load]);

  const onCreate = useCallback(() => { startNew(); setSelectedId(null); }, [startNew]);

  const onSave = useCallback(async () => {
    if (draft?.isActive && !window.confirm("Esta regla está activa: los cambios aplican a disparos nuevos. ¿Guardar?")) return;
    const ok = await save();
    if (ok) await refreshData();
  }, [draft, save, refreshData]);

  const onDiscard = useCallback(() => { discard(); setSelectedId(null); }, [discard]);

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
          {mode === "targeted" && !editing && (
            <>
              <select value={campaign} onChange={(e) => setCampaign(e.target.value)} className="rounded-md border border-neutral-300 px-2 py-1 text-xs bg-transparent">
                <option value="">— elige campaña —</option>
                {campaigns.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <select value="" onChange={(e) => e.target.value && onSelectRule(e.target.value)} className="rounded-md border border-neutral-300 px-2 py-1 text-xs bg-transparent">
                <option value="">— editar regla —</option>
                {rules.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              <button onClick={onCreate} className="rounded-md border border-neutral-300 px-3 py-1 text-xs font-medium">+ Crear regla</button>
            </>
          )}
          {mode === "targeted" && editing && (
            <>
              {isDirty && <span className="text-xs text-amber-600">● sin guardar</span>}
              {error && <span className="text-xs text-red-600">{error}</span>}
              <button onClick={onSave} disabled={!isDirty || saving} className="rounded-md bg-neutral-900 px-3 py-1 text-xs font-medium text-white disabled:opacity-40">{saving ? "Guardando…" : "Guardar"}</button>
              <button onClick={onDiscard} className="rounded-md border border-neutral-300 px-3 py-1 text-xs font-medium">Descartar</button>
              <div className="relative">
                <button
                  onClick={() => draft && setPaletteAt(draft.actions.length)}
                  className="rounded-md border border-neutral-300 px-3 py-1 text-xs font-medium"
                >
                  + Añadir
                </button>
                {paletteAt !== null && (
                  <NodePalette
                    onPick={(type) => { ops.insertAction(type, paletteAt); setPaletteAt(null); }}
                    onClose={() => setPaletteAt(null)}
                  />
                )}
              </div>
            </>
          )}
        </div>
      </header>
      <div className="flex flex-1 min-h-0">
        <div className="flex-1">
          <ReactFlow
            nodes={typedNodes} edges={edges}
            onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
            onNodeDragStop={onNodeDragStop} onNodeClick={onNodeClick}
            nodesConnectable={false} deleteKeyCode={null} fitView proOptions={{ hideAttribution: true }}
            edgeTypes={EDGE_TYPES}
          >
            <Background />
            <Controls />
            <MiniMap pannable zoomable />
          </ReactFlow>
        </div>
        {editing && draft && (
          <div className="w-80 shrink-0 overflow-y-auto border-l border-neutral-200 p-4 dark:border-neutral-800">
            <RuleInspectorPanel draft={draft} selectedId={selectedId} ops={ops} />
          </div>
        )}
      </div>
      <p className="border-t border-neutral-200 px-6 py-1.5 text-xs text-neutral-400 dark:border-neutral-800">
        {editing
          ? "Edición de regla: selecciona un nodo para ver sus campos. Usa ⊕ para insertar acciones. Guardar escribe al motor."
          : "Solo lectura. Mueve los nodos para acomodar; el acomodo se guarda. En Dirigida puedes editar una regla. Cadencias se editan en Configuración → Automatización."}
      </p>
    </div>
  );
}
