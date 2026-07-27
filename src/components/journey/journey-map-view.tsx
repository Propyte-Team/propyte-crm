"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ReactFlow, Background, Controls, MiniMap, useNodesState, useEdgesState,
  Handle, Position,
  type Node, type Edge, type EdgeTypes, type NodeTypes, type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { LIFECYCLE_COLORS, STAGE_COLORS, STAGE_LABELS } from "@/lib/constants";
import {
  buildGeneralView, buildTargetedView, extractCampaigns, deriveSlaPanel, resolveRuleJourneyLink,
  type RuleLite, type PlanLite, type SlaPolicyLite,
} from "@/lib/journey/journey-map";
import { generalToFlow, targetedToFlow, applyPositions, type Positions } from "@/lib/journey/flow-adapter";
import { draftToFlow, type RuleRow } from "@/lib/journey/rule-draft";
import { computeNodeMetrics, type RawMetrics, type NodeMetrics } from "@/lib/journey/node-metrics";
import { labelFor, summaryFor } from "@/lib/journey/node-catalog";
import { useRuleDraft } from "./use-rule-draft";
import { RuleInspectorPanel } from "./rule-inspector-panel";
import { NodePalette } from "./node-palette";
import { InsertEdge } from "./insert-edge";

type Mode = "general" | "targeted";

// Stable module-scope reference so ReactFlow doesn't remount on render
const EDGE_TYPES: EdgeTypes = { insert: InsertEdge as EdgeTypes[string] };

// ─── Decision (diamond) node ──────────────────────────────────────────────────
function DecisionNode({ data }: NodeProps) {
  const d = data as Record<string, unknown>;
  const label = d.label as string | undefined;
  const metricVolume = d.metricVolume as number | undefined;
  return (
    // Outer wrapper: provides a solid background so the canvas grid doesn't bleed
    // through the diamond's bounding-box corners. Selection outline is applied by
    // nodeStyle() via the React Flow node's `style` prop — single source of truth.
    <div
      style={{
        width: 80, height: 80,
        background: "var(--card, #fff)",
        display: "flex", alignItems: "center", justifyContent: "center",
        position: "relative",
      }}
    >
      <div
        style={{
          width: 80, height: 80,
          transform: "rotate(45deg)",
          background: "#7c3aed",
          borderRadius: 6,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >
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

const NODE_TYPES: NodeTypes = { decision: DecisionNode as NodeTypes[string] };

function nodeStyle(type: string, data: Record<string, unknown>, selected: boolean): React.CSSProperties {
  const dim = data.isActive === false ? 0.5 : 1;
  const sel = selected ? { outline: "2px solid #0a0a0a", outlineOffset: 2 } : {};
  if (type === "stage") {
    // General: data.stage (lifecycle). Edición CHANGE_STAGE: config.toStage (pipeline).
    const lifecycle = String((data.stage as string | undefined) ?? "");
    const pipeline = String((data.config as Record<string, unknown> | undefined)?.toStage ?? "");
    const bg = LIFECYCLE_COLORS[lifecycle] ?? STAGE_COLORS[pipeline] ?? "#6B7280";
    return { background: bg, color: "#fff", border: "none", borderRadius: 8, padding: 8, fontSize: 12, fontWeight: 600, opacity: dim, ...sel };
  }
  if (type === "trigger") return { background: "#2563eb", color: "#fff", borderRadius: 8, padding: 8, fontSize: 12, opacity: dim, ...sel };
  if (type === "cadence") return { border: "1px dashed #9ca3af", borderRadius: 8, padding: 8, fontSize: 12, background: "#fff", opacity: dim, ...sel };
  if (type === "condition") return { border: "1px dashed #9ca3af", borderRadius: 8, padding: 8, fontSize: 12, opacity: dim, ...sel };
  return { border: "1px solid #d1d5db", borderRadius: 8, padding: 8, fontSize: 12, background: "#fff", opacity: dim, ...sel };
}

function nodeLabel(type: string, data: Record<string, unknown>): string {
  let label: string;
  if (type === "stage") {
    // Vista General: el carril ya trae su label (etapa de lifecycle). Edición: deriva de config.toStage (pipeline).
    label = typeof data.label === "string" && data.label
      ? data.label
      : (() => { const s = String((data.config as Record<string, unknown> | undefined)?.toStage ?? ""); return s ? `Etapa → ${STAGE_LABELS[s] ?? s}` : "Etapa"; })();
  } else if (data.actionType) {
    label = summaryFor(String(data.actionType), (data.config ?? {}) as Record<string, unknown>);
  } else if (typeof data.label === "string" && data.label) {
    label = data.label;
  } else {
    label = labelFor(type) || type;
  }
  // Marca SLA (Tarea 1): reglas/triggers con triggerType SLA_BREACH (ver isSlaTriggeredRule
  // en journey-map.ts, propagado a data.isSlaBreach por generalToFlow/targetedToFlow).
  return data.isSlaBreach ? `⏱️ ${label}` : label;
}

export function JourneyMapView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [plans, setPlans] = useState<PlanLite[]>([]);
  const [slas, setSlas] = useState<SlaPolicyLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<Mode>("general");
  const [campaign, setCampaign] = useState("");
  const [slaOpen, setSlaOpen] = useState(false);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { draft, isDirty, saving, error, load, startNew, ops, save, discard } = useRuleDraft();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [paletteAt, setPaletteAt] = useState<number | null>(null);
  const editing = draft !== null;

  // ─── Metrics overlay state ────────────────────────────────────────────────────
  const [metricsOn, setMetricsOn] = useState(false);
  const [metricsWindow, setMetricsWindow] = useState<"7" | "30" | "90" | "all">("30");
  const [metrics, setMetrics] = useState<NodeMetrics | null>(null);
  const [metricsTotal, setMetricsTotal] = useState(0);

  const scope = mode === "general" ? "general" : `targeted:${campaign}`;

  // Fetch metrics when overlay is active and a saved rule is loaded.
  useEffect(() => {
    const ruleId = draft?.id;
    if (!metricsOn || !ruleId) { setMetrics(null); return; }
    let cancel = false;
    fetch(`/api/admin/journey/metrics?ruleId=${encodeURIComponent(ruleId)}&window=${metricsWindow}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((raw: RawMetrics | null) => {
        if (cancel || !raw) return;
        setMetricsTotal(raw.total ?? 0);
        setMetrics(computeNodeMetrics(draft!, raw)); // draft no-null: garantizado por el guard `ruleId`
      })
      .catch(() => { if (!cancel) setMetrics(null); });
    return () => { cancel = true; };
  }, [metricsOn, metricsWindow, draft?.id, draft]);

  const refreshData = useCallback(() => {
    return fetch("/api/admin/automation").then((r) => r.json()).then((j) => {
      const d = j.data ?? j;
      setRules((d.rules ?? []) as RuleRow[]);
      setPlans((d.plans ?? []) as PlanLite[]);
      setSlas((d.slaPolicies ?? []) as SlaPolicyLite[]);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  useEffect(() => { refreshData(); }, [refreshData]);

  const campaigns = useMemo(() => extractCampaigns(rules as unknown as RuleLite[]), [rules]);
  const slaRows = useMemo(() => deriveSlaPanel(slas), [slas]);

  // Deep-link desde Configuración (Tarea 3): /journey?mode=targeted&ruleId=<id> — reusa el
  // flujo EXISTENTE de edición dirigida (load() de useRuleDraft), no uno paralelo. Se aplica
  // una sola vez, tras el primer fetch (rules ya disponibles). Si la regla no referencia una
  // campaña (resolveRuleJourneyLink → "general"), degrada sin crashear: se queda en General.
  const deepLinkApplied = useRef(false);
  useEffect(() => {
    if (deepLinkApplied.current || loading) return;
    deepLinkApplied.current = true;
    const dlMode = searchParams.get("mode");
    const ruleId = searchParams.get("ruleId");
    if (dlMode !== "targeted" || !ruleId) return;
    const r = rules.find((x) => x.id === ruleId);
    const link = resolveRuleJourneyLink(r as unknown as RuleLite | undefined);
    if (link.mode === "targeted") {
      setMode("targeted");
      setCampaign(link.campaign);
      load(r!);
      setSelectedId(null);
    }
    // else: degradación a General (rama por defecto) — regla sin señal de campaña o inexistente.
  }, [loading, rules, searchParams, load]);

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
      const eData = e.data as { label?: string; branchId?: string } | undefined;
      const branchLabel = eData?.label;
      const split = metricsOn && metrics && eData?.branchId ? metrics.branchSplits[eData.branchId] : undefined;
      const metricText = split ? `${split.pct}% · ${split.count}` : undefined;
      const finalLabel = metricText
        ? (branchLabel ? `${branchLabel} · ${metricText}` : metricText)
        : branchLabel;
      const m = /^a(\d+)$/.exec(e.target);
      return m
        ? { ...e, type: "insert", label: finalLabel, data: { onInsert: () => setPaletteAt(Number(m[1])), label: finalLabel } }
        : { ...e, label: finalLabel };
    });
    setNodes(flow.nodes as unknown as Node[]);
    setEdges(editEdges as unknown as Edge[]);
  }, [draft, setNodes, setEdges, metricsOn, metrics]);

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
    if (node.type === "cadence") {
      // Tarea 2: deep-link a la cadencia específica (ActionPlan) que representa este nodo,
      // no un push genérico a /configuracion. planId viene de data (ver typedNodes abajo,
      // originado en generalToFlow/targetedToFlow → journey-map.ts CadenceNode.id / FlowNode.planId).
      const planId = (node.data as Record<string, unknown> | undefined)?.planId as string | undefined;
      router.push(planId ? `/configuracion?section=automation&planId=${encodeURIComponent(planId)}` : "/configuracion?section=automation");
    }
  }, [editing, router]);

  const typedNodes = useMemo(() => nodes.map((n) => {
    const d = n.data as Record<string, unknown>;
    const baseLabel = nodeLabel(n.type ?? "action", d);
    const vol = metricsOn && metrics ? (metrics.nodeVolumes[n.id] ?? 0) : undefined;
    const label = vol !== undefined && n.type !== "decision" ? `${vol} · ${baseLabel}` : baseLabel;
    const data: Record<string, unknown> = { label };
    if (n.type === "decision" && vol !== undefined) data.metricVolume = vol;
    // Preservar planId/isSlaBreach para el click handler y el badge (nodeLabel ya los leyó
    // arriba para el label; onNodeClick los necesita en el nodo final que recibe el evento).
    if (d.planId) data.planId = d.planId;
    if (d.isSlaBreach) data.isSlaBreach = d.isSlaBreach;
    return { ...n, data, style: nodeStyle(n.type ?? "action", d, n.id === selectedId) };
  }), [nodes, selectedId, metricsOn, metrics]);

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
  // slas.length también cuenta: sin esto, una cuenta con solo políticas SLA (sin reglas/cadencias
  // aún) nunca vería el panel SLA — quedaría atrapada en este estado vacío (Tarea 1).
  if (!rules.length && !plans.length && !slas.length) return <div className="p-8 text-sm text-neutral-500">Sin reglas ni cadencias configuradas. Créalas en Configuración → Automatización.</div>;

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      <header className="flex items-center gap-3 border-b border-neutral-200 px-6 py-3 dark:border-neutral-800">
        <h1 className="text-lg font-semibold tracking-tight">Mapa de Journey</h1>
        <div className="ml-auto flex items-center gap-2 text-sm">
          <div className="inline-flex rounded-md border border-neutral-300 p-0.5">
            <button onClick={() => setMode("general")} className={`px-3 py-1 rounded text-xs font-medium transition-colors ${mode === "general" ? "bg-neutral-900 text-white" : "text-neutral-600"}`}>General</button>
            <button onClick={() => setMode("targeted")} className={`px-3 py-1 rounded text-xs font-medium transition-colors ${mode === "targeted" ? "bg-neutral-900 text-white" : "text-neutral-600"}`}>Dirigida</button>
          </div>
          {!editing && (
            <button
              type="button"
              onClick={() => setSlaOpen((v) => !v)}
              className={`rounded-md px-3 py-1 text-xs font-medium ${slaOpen ? "bg-neutral-900 text-white" : "border border-neutral-300"}`}
              title="Políticas SLA activas"
            >
              ⏱ SLA{slaRows.length > 0 ? ` (${slaRows.length})` : ""}
            </button>
          )}
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
                    onAddDecision={() => { ops.addDecision(); setPaletteAt(null); }}
                  />
                )}
              </div>
              {draft?.id && (
                <>
                  <button
                    type="button"
                    onClick={() => setMetricsOn((v) => !v)}
                    className={`rounded-md px-3 py-1 text-xs font-medium ${metricsOn ? "bg-neutral-900 text-white" : "border border-neutral-300"}`}
                  >
                    ● Métricas
                  </button>
                  {metricsOn && (
                    <>
                      <select
                        className="rounded-md border border-neutral-300 px-2 py-1 text-xs bg-transparent"
                        value={metricsWindow}
                        onChange={(e) => setMetricsWindow(e.target.value as "7" | "30" | "90" | "all")}
                      >
                        <option value="7">7d</option>
                        <option value="30">30d</option>
                        <option value="90">90d</option>
                        <option value="all">Todo</option>
                      </select>
                      <span className="text-xs text-neutral-500">
                        {metricsTotal} contactos · {metricsWindow === "all" ? "histórico" : `${metricsWindow}d`}
                      </span>
                    </>
                  )}
                </>
              )}
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
            onPaneClick={() => setSelectedId(null)}
            nodesConnectable={false} deleteKeyCode={null} fitView proOptions={{ hideAttribution: true }}
            edgeTypes={EDGE_TYPES}
            nodeTypes={NODE_TYPES}
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
        {!editing && slaOpen && (
          <div className="w-80 shrink-0 overflow-y-auto border-l border-neutral-200 p-4 dark:border-neutral-800">
            <h2 className="mb-3 text-sm font-semibold">Políticas SLA activas</h2>
            {slaRows.length === 0 && (
              <p className="text-xs text-neutral-500">Sin políticas SLA activas.</p>
            )}
            <ul className="space-y-3">
              {slaRows.map((s) => (
                <li key={s.id} className="rounded-md border border-neutral-200 p-3 text-xs dark:border-neutral-800">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{s.name}</span>
                    {s.isDefault && (
                      <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                        default
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-neutral-500">
                    1er toque {s.firstTouchMinutes}min · reintento {s.retryMinutes}min · huérfano {s.orphanHours}h · prioridad {s.priority}
                  </p>
                  <p className="mt-1 text-neutral-500">{s.conditionsSummary}</p>
                  <a
                    href={`/configuracion?section=automation&slaId=${encodeURIComponent(s.id)}`}
                    className="mt-2 inline-block font-medium text-neutral-900 underline dark:text-neutral-100"
                  >
                    Editar →
                  </a>
                </li>
              ))}
            </ul>
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
