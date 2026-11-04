"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ReactFlow, Background, Controls, MiniMap, useNodesState, useEdgesState, useReactFlow,
  Handle, Position,
  type Node, type Edge, type EdgeTypes, type NodeTypes, type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { LIFECYCLE_COLORS, STAGE_COLORS, STAGE_LABELS } from "@/lib/constants";
import { toast } from "@/components/ui/use-toast";
import { leerError } from "@/lib/api-errors";
import {
  buildGeneralView, buildTargetedView, buildRuleView, extractCampaigns, deriveSlaPanel, resolveRuleJourneyLink,
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
    // Contenedor SIN fondo ni borde (E4 #10): antes llevaba fondo blanco y el rombo se veia dentro
    // de una caja. El resalte de seleccion lo aplica nodeStyle() por la prop `style` del nodo.
    <div
      style={{
        width: 80, height: 80,
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

// Nodo generico para rule/cadence/stage/trigger/condition/action (E4 #13): mismos handles que el
// nodo por defecto de React Flow (arriba/abajo) pero registrado, asi desaparece el aviso de consola
// "Node type not found". El aspecto sigue viniendo de nodeStyle() (sin rediseno visual).
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

// Referencia estable a nivel de modulo para que React Flow no remonte nodos en cada render.
const NODE_TYPES: NodeTypes = {
  decision: DecisionNode as NodeTypes[string],
  rule: BasicNode as NodeTypes[string],
  cadence: BasicNode as NodeTypes[string],
  stage: BasicNode as NodeTypes[string],
  trigger: BasicNode as NodeTypes[string],
  condition: BasicNode as NodeTypes[string],
  action: BasicNode as NodeTypes[string],
};

// Re-encuadra el lienzo cuando cambia `token` (E4 #12). Debe vivir DENTRO de <ReactFlow> para poder
// usar useReactFlow; el retraso corto deja que React Flow mida los nodos nuevos antes de encuadrar.
function FitOnChange({ token }: { token: string }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    const t = setTimeout(() => { fitView({ padding: 0.15, duration: 200 }); }, 60);
    return () => clearTimeout(t);
  }, [token, fitView]);
  return null;
}

function nodeStyle(type: string, data: Record<string, unknown>, selected: boolean): React.CSSProperties {
  const dim = data.isActive === false ? 0.5 : 1;
  const sel = selected ? { outline: "2px solid #0a0a0a", outlineOffset: 2 } : {};
  // El rombo dibuja su propia forma: el contenedor no lleva borde, padding ni fondo (E4 #10).
  if (type === "decision") return { opacity: dim, ...sel };
  if (type === "stage") {
    // General: data.stage (lifecycle). Edición CHANGE_STAGE: config.toStage (pipeline).
    const lifecycle = String((data.stage as string | undefined) ?? "");
    const pipeline = String((data.config as Record<string, unknown> | undefined)?.toStage ?? "");
    // Carriles de la vista General: data.stage puede ser etapa de lifecycle o de pipeline.
    const bg = LIFECYCLE_COLORS[lifecycle] ?? STAGE_COLORS[pipeline] ?? STAGE_COLORS[lifecycle] ?? "#6B7280";
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
  // Dirigida "por regla" (E4 #2): regla elegida para verla en solo lectura, sin exigir campaña.
  const [viewRuleId, setViewRuleId] = useState<string | null>(null);
  const [slaOpen, setSlaOpen] = useState(false);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Posiciones arrastradas durante la sesión de edición (nodeId → posición), para que el
  // auto-layout del draft no las deshaga en cada cambio (E4 #12).
  const dragPos = useRef<Record<string, { x: number; y: number }>>({});

  const { draft, isDirty, saving, error, load, startNew, ops, save, discard } = useRuleDraft();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [paletteAt, setPaletteAt] = useState<number | null>(null);
  const editing = draft !== null;

  // ─── Metrics overlay state ────────────────────────────────────────────────────
  const [metricsOn, setMetricsOn] = useState(false);
  const [metricsWindow, setMetricsWindow] = useState<"7" | "30" | "90" | "all">("30");
  const [metrics, setMetrics] = useState<NodeMetrics | null>(null);
  const [metricsTotal, setMetricsTotal] = useState(0);

  const scope = mode === "general" ? "general" : viewRuleId ? `rule:${viewRuleId}` : `targeted:${campaign}`;

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

  // Deep-link desde Configuración: /journey?mode=targeted&ruleId=<id>. Si la regla existe se abre
  // SIEMPRE en edición (E4 #1): antes solo las reglas con campaña se abrían y el resto aterrizaba
  // en General sin aviso. Si no existe, se avisa y se queda en General. Se aplica una sola vez,
  // tras el primer fetch (rules ya disponibles).
  const deepLinkApplied = useRef(false);
  useEffect(() => {
    if (deepLinkApplied.current || loading) return;
    deepLinkApplied.current = true;
    const dlMode = searchParams.get("mode");
    const ruleId = searchParams.get("ruleId");
    if (!ruleId || dlMode === "general") return;
    const r = rules.find((x) => x.id === ruleId);
    const link = resolveRuleJourneyLink(r as unknown as RuleLite | undefined);
    if (link.mode === "targeted" && r) {
      setMode("targeted");
      setCampaign(link.campaign);
      setViewRuleId(null);
      load(r);
      setSelectedId(null);
    } else {
      toast({
        title: "No encontramos esa regla",
        description: "Puede que se haya eliminado. Te mostramos el mapa general.",
        variant: "destructive",
      });
    }
  }, [loading, rules, searchParams, load]);

  // Salir de edición si se vuelve a General (solo Dirigida es editable).
  useEffect(() => { if (mode === "general" && draft) { discard(); setSelectedId(null); } }, [mode, draft, discard]);

  // READ-ONLY: reconstruir flujo + layout guardado cuando cambian datos/scope (no en edición).
  useEffect(() => {
    if (editing) return;
    const asRules = rules as unknown as RuleLite[];
    const flow = mode === "general"
      ? generalToFlow(buildGeneralView(asRules, plans))
      : viewRuleId ? targetedToFlow(buildRuleView(asRules, plans, viewRuleId))
      : campaign ? targetedToFlow(buildTargetedView(asRules, plans, { campaign }))
      : { nodes: [], edges: [] };
    // Flag de cancelación (E4 #8): si el usuario entra a editar (o cambia de scope) antes de que
    // resuelva el fetch del layout, este resultado ya no debe pisar el lienzo del draft.
    let cancel = false;
    fetch(`/api/admin/journey/layout?scope=${encodeURIComponent(scope)}`)
      .then((r) => r.ok ? r.json() : { positions: {} })
      .catch(() => ({ positions: {} }))
      .then((j) => {
        if (cancel) return;
        const positioned = applyPositions(flow.nodes, (j.positions ?? {}) as Positions);
        setNodes(positioned as unknown as Node[]);
        setEdges(flow.edges as unknown as Edge[]);
      });
    return () => { cancel = true; };
  }, [rules, plans, mode, campaign, viewRuleId, scope, editing, setNodes, setEdges]);

  // Al cambiar de regla (o salir de edición) se olvidan las posiciones arrastradas de la sesión anterior.
  // Va ANTES del efecto de edición para que el primer render del draft nuevo parta de cero.
  useEffect(() => { dragPos.current = {}; }, [editing, draft?.id]);

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
    // Auto-layout del draft, pero respetando lo que el usuario movió a mano en esta sesión (E4 #12).
    setNodes(applyPositions(flow.nodes, dragPos.current) as unknown as Node[]);
    setEdges(editEdges as unknown as Edge[]);
  }, [draft, setNodes, setEdges, metricsOn, metrics]);

  const persist = useCallback((current: Node[]) => {
    const positions: Positions = {};
    for (const n of current) positions[n.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) };
    // Antes el fallo se tragaba en silencio (E4 #7): el acomodo "volvía" al recargar sin explicación.
    const avisar = (description?: string) =>
      toast({ title: "No se pudo guardar el acomodo", description, variant: "destructive" });
    fetch("/api/admin/journey/layout", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope, positions }),
    })
      .then(async (r) => { if (!r.ok) avisar(await leerError(r, "Intenta de nuevo en un momento.")); })
      .catch(() => avisar("Revisa tu conexión e intenta de nuevo."));
  }, [scope]);

  const onNodeDragStop = useCallback((_e: unknown, node: Node, dragged?: Node[]) => {
    if (editing) {
      // En edición no se persiste en BD, solo se recuerda en memoria durante la sesión.
      for (const n of dragged && dragged.length ? dragged : [node]) dragPos.current[n.id] = { x: n.position.x, y: n.position.y };
      return;
    }
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

  // Ver una regla en solo lectura (Dirigida por regla) — no exige campaña.
  const onViewRule = useCallback((id: string) => { setViewRuleId(id || null); setCampaign(""); }, []);

  // Token de re-encuadre: cambia al cambiar de modo/vista/regla y cuando cambia la cantidad de nodos.
  const fitToken = `${mode}|${campaign}|${viewRuleId ?? ""}|${editing ? draft?.id ?? "new" : "ro"}|${nodes.length}`;

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

  // Alto real (E4 #5): el layout pone topbar de 3rem y <main> con p-6; -m-6 anula ese padding y
  // 100vh-3rem es justo el alto de <main>, asi que no aparece scroll ni se cortan los controles.
  return (
    <div className="-m-6 flex h-[calc(100vh-3rem)] flex-col">
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
              {campaigns.length > 0 && (
                <select value={campaign} onChange={(e) => { setCampaign(e.target.value); setViewRuleId(null); }} className="rounded-md border border-neutral-300 px-2 py-1 text-xs bg-transparent">
                  <option value="">— campaña —</option>
                  {campaigns.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              )}
              <select value={viewRuleId ?? ""} onChange={(e) => onViewRule(e.target.value)} className="rounded-md border border-neutral-300 px-2 py-1 text-xs bg-transparent">
                <option value="">— ver una regla —</option>
                {rules.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              {viewRuleId && (
                <button onClick={() => onSelectRule(viewRuleId)} className="rounded-md border border-neutral-300 px-3 py-1 text-xs font-medium">Editar esta regla</button>
              )}
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
        <div className="relative flex-1">
          {mode === "targeted" && !editing && !campaign && !viewRuleId && (
            // Estado vacío (E4 #2): Dirigida ya no deja el lienzo en blanco sin explicar.
            <div className="absolute inset-0 z-10 flex items-center justify-center p-6">
              <div className="max-w-md rounded-lg border border-neutral-200 bg-white p-5 text-sm shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
                <p className="font-medium">
                  {campaigns.length === 0
                    ? "Ninguna regla segmenta por campaña."
                    : "Elige una campaña o una regla para verla."}
                </p>
                <p className="mt-1 text-xs text-neutral-500">Elige una regla para ver su flujo y, si quieres, editarla.</p>
                <ul className="mt-3 max-h-48 space-y-1 overflow-y-auto">
                  {rules.map((r) => (
                    <li key={r.id}>
                      <button onClick={() => onViewRule(r.id)} className="w-full rounded px-2 py-1 text-left text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800">
                        {r.name}{r.isActive ? "" : " (inactiva)"}
                      </button>
                    </li>
                  ))}
                </ul>
                <button onClick={onCreate} className="mt-3 rounded-md border border-neutral-300 px-3 py-1 text-xs font-medium">+ Crear regla</button>
              </div>
            </div>
          )}
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
            <FitOnChange token={fitToken} />
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
          : "Solo lectura. Mueve los nodos para acomodar; el acomodo se guarda. En Dirigida puedes ver cualquier regla y editarla. Cadencias se editan en Configuración → Automatización."}
      </p>
    </div>
  );
}
