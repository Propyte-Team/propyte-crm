"use client";
// Mapa de Journey, SOLO LECTURA (E4-C). Las reglas se editan en Configuracion (constructor
// "Cuando · Si · Entonces" + vista avanzada para ramas). Aqui: mapa general por etapas, una regla
// con sus metricas ("Por regla"), panel de SLA y enlaces a Configuracion.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ReactFlow, Background, Controls, MiniMap, useNodesState, useEdgesState, type Node, type Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { toast } from "@/components/ui/use-toast";
import { leerError } from "@/lib/api-errors";
import {
  buildGeneralView, deriveSlaPanel, type RuleLite, type PlanLite, type SlaPolicyLite,
} from "@/lib/journey/journey-map";
import { generalToFlow, applyPositions, type Positions } from "@/lib/journey/flow-adapter";
import { draftToFlow, ruleToDraft, isDecisionDraft, type RuleRow, type RuleDraft } from "@/lib/journey/rule-draft";
import { computeNodeMetrics, type RawMetrics, type NodeMetrics } from "@/lib/journey/node-metrics";
import { summaryFor } from "@/lib/journey/node-catalog";
import { ReglasResumen } from "./reglas-resumen";
import { EDGE_TYPES, NODE_TYPES, FitOnChange, decorateNodes, edgeLabel } from "./flow-nodes";

type Mode = "general" | "rule" | "resumen";
type Win = "7" | "30" | "90" | "all";

const scope = "general";
const editarHref = (id: string) => `/configuracion?section=automation&ruleId=${encodeURIComponent(id)}`;

export function JourneyMapView({ abrirRegla = null }: { abrirRegla?: { id: string; n: number } | null }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [plans, setPlans] = useState<PlanLite[]>([]);
  const [slas, setSlas] = useState<SlaPolicyLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [intento, setIntento] = useState(0);
  const [mode, setMode] = useState<Mode>("general");
  // Regla elegida: en "Por regla" es la que se dibuja; en General es la del panel de metricas.
  const [ruleId, setRuleId] = useState<string | null>(null);
  const [slaOpen, setSlaOpen] = useState(false);
  const [metricsWindow, setMetricsWindow] = useState<Win>("30");
  const [raw, setRaw] = useState<RawMetrics | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const rule = useMemo(() => rules.find((r) => r.id === ruleId) ?? null, [rules, ruleId]);
  const draft: RuleDraft | null = useMemo(() => (rule ? ruleToDraft(rule) : null), [rule]);
  const metrics: NodeMetrics | null = useMemo(() => (draft && raw ? computeNodeMetrics(draft, raw) : null), [draft, raw]);

  useEffect(() => {
    // Si la carga falla no se muestra «Sin reglas»: eso era mentira con la base saturada.
    setLoading(true);
    setErrorCarga(null);
    fetch("/api/admin/automation").then(async (r) => {
      if (!r.ok) throw new Error(await leerError(r, "No se pudieron cargar las reglas."));
      return r.json();
    }).then((j) => {
      const d = j.data ?? j;
      setRules((d.rules ?? []) as RuleRow[]);
      setPlans((d.plans ?? []) as PlanLite[]);
      setSlas((d.slaPolicies ?? []) as SlaPolicyLite[]);
      setLoading(false);
    }).catch((e: unknown) => {
      setErrorCarga(e instanceof Error ? e.message : "No se pudieron cargar las reglas.");
      setLoading(false);
    });
  }, [intento]);

  const slaRows = useMemo(() => deriveSlaPanel(slas), [slas]);

  // Deep-link /journey?ruleId=<id> ("Ver en el mapa"): abre "Por regla" con esa regla, una sola vez.
  const deepLinkApplied = useRef(false);
  useEffect(() => {
    if (deepLinkApplied.current || loading) return;
    deepLinkApplied.current = true;
    const id = searchParams.get("ruleId");
    if (!id) return;
    if (rules.some((x) => x.id === id)) { setMode("rule"); setRuleId(id); }
    else toast({ title: "No encontramos esa regla", description: "Puede que se haya eliminado. Te mostramos el mapa general.", variant: "destructive" });
  }, [loading, rules, searchParams]);

  // Una pastilla del embudo (J1) pide abrir el flujo de una regla.
  useEffect(() => {
    if (!abrirRegla || loading) return;
    if (rules.some((x) => x.id === abrirRegla.id)) { setMode("rule"); setRuleId(abrirRegla.id); }
  }, [abrirRegla, loading, rules]);

  // Metricas de la regla elegida (la API solo da metricas por regla).
  useEffect(() => {
    if (!ruleId) { setRaw(null); return; }
    let cancel = false;
    setRaw(null);
    fetch(`/api/admin/journey/metrics?ruleId=${encodeURIComponent(ruleId)}&window=${metricsWindow}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: RawMetrics | null) => { if (!cancel) setRaw(j); })
      .catch(() => { if (!cancel) setRaw(null); });
    return () => { cancel = true; };
  }, [ruleId, metricsWindow]);

  // Lienzo "Por regla": flujo de la regla (auto-layout, con metricas por nodo).
  useEffect(() => {
    if (mode !== "rule") return;
    if (!draft) { setNodes([]); setEdges([]); return; }
    const flow = draftToFlow(draft);
    setNodes(flow.nodes as unknown as Node[]);
    setEdges(flow.edges.map((e) => ({ ...e, label: edgeLabel(e, metrics) })) as unknown as Edge[]);
  }, [mode, draft, metrics, setNodes, setEdges]);

  // Lienzo General: carriles + acomodo guardado.
  useEffect(() => {
    if (mode !== "general") return;
    const flow = generalToFlow(buildGeneralView(rules as unknown as RuleLite[], plans));
    let cancel = false;
    fetch(`/api/admin/journey/layout?scope=${scope}`)
      .then((r) => (r.ok ? r.json() : { positions: {} }))
      .catch(() => ({ positions: {} }))
      .then((j) => {
        if (cancel) return;
        setNodes(applyPositions(flow.nodes, (j.positions ?? {}) as Positions) as unknown as Node[]);
        setEdges(flow.edges as unknown as Edge[]);
      });
    return () => { cancel = true; };
  }, [mode, rules, plans, setNodes, setEdges]);

  const persist = useCallback((current: Node[]) => {
    const positions: Positions = {};
    for (const n of current) positions[n.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) };
    const avisar = (description?: string) => toast({ title: "No se pudo guardar el acomodo", description, variant: "destructive" });
    fetch("/api/admin/journey/layout", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope, positions }),
    })
      .then(async (r) => { if (!r.ok) avisar(await leerError(r, "Intenta de nuevo en un momento.")); })
      .catch(() => avisar("Revisa tu conexión e intenta de nuevo."));
  }, []);

  const onNodeDragStop = useCallback(() => {
    if (mode !== "general") return; // el acomodo solo se guarda en el mapa general
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => setNodes((nds) => { persist(nds); return nds; }), 600);
  }, [mode, persist, setNodes]);
  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  const onNodeClick = useCallback((_e: React.MouseEvent, node: Node) => {
    if (mode !== "general") return;
    if (node.type === "rule" && node.id.startsWith("rule:")) { setRuleId(node.id.slice(5)); return; }
    if (node.type === "cadence") {
      const planId = (node.data as Record<string, unknown> | undefined)?.planId as string | undefined;
      router.push(planId ? `/configuracion?section=automation&planId=${encodeURIComponent(planId)}` : "/configuracion?section=automation");
    }
  }, [mode, router]);

  const shownNodes = useMemo(
    () => decorateNodes(nodes, { selectedId: mode === "general" && ruleId ? `rule:${ruleId}` : null, metrics: mode === "rule" ? metrics : null }),
    [nodes, mode, ruleId, metrics],
  );

  const sinDatos = !!raw && raw.total === 0;
  const volumenes = useMemo(() => {
    if (!draft || !metrics) return [];
    return draft.actions.map((n) => ({
      id: n.nodeId,
      label: isDecisionDraft(n) ? (n.label || "Decisión") : summaryFor(n.type, n.config),
      count: metrics.nodeVolumes[n.nodeId] ?? 0,
    }));
  }, [draft, metrics]);

  if (loading) return <div className="p-8 text-sm text-neutral-500">Cargando mapa…</div>;
  if (errorCarga) {
    return (
      <div className="p-8 text-sm text-neutral-600">
        {errorCarga}{" "}
        <button type="button" className="underline" onClick={() => setIntento((n) => n + 1)}>Reintentar</button>
      </div>
    );
  }
  if (!rules.length && !plans.length && !slas.length) return <div className="p-8 text-sm text-neutral-500">Sin reglas ni cadencias configuradas. Créalas en Configuración → Automatización.</div>;

  const tab = (m: Mode, label: string) => (
    <button onClick={() => setMode(m)} className={`px-3 py-1 rounded text-xs font-medium transition-colors ${mode === m ? "bg-neutral-900 text-white" : "text-neutral-600"}`}>{label}</button>
  );

  return (
    <div className="-m-6 flex h-[calc(100vh-3rem)] flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-neutral-200 px-6 py-3 dark:border-neutral-800">
        <h1 className="text-lg font-semibold tracking-tight">Mapa de Journey</h1>
        <div className="ml-auto flex flex-wrap items-center gap-2 text-sm">
          <div className="inline-flex rounded-md border border-neutral-300 p-0.5">{tab("general", "General")}{tab("rule", "Por regla")}{tab("resumen", "Todas las reglas")}</div>
          <select value={metricsWindow} onChange={(e) => setMetricsWindow(e.target.value as Win)} className="rounded-md border border-neutral-300 bg-transparent px-2 py-1 text-xs" aria-label="Ventana de métricas">
            <option value="7">7 días</option><option value="30">30 días</option><option value="90">90 días</option><option value="all">Todo</option>
          </select>
          <button type="button" onClick={() => setSlaOpen((v) => !v)} className={`rounded-md px-3 py-1 text-xs font-medium ${slaOpen ? "bg-neutral-900 text-white" : "border border-neutral-300"}`} title="Políticas SLA activas">
            ⏱ SLA{slaRows.length > 0 ? ` (${slaRows.length})` : ""}
          </button>
          {rule && (
            <a href={editarHref(rule.id)} className="rounded-md border border-neutral-300 px-3 py-1 text-xs font-medium">Editar en Configuración</a>
          )}
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        {mode === "rule" && (
          <aside className="w-64 shrink-0 overflow-y-auto border-r border-neutral-200 p-3 dark:border-neutral-800">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">Reglas</h2>
            <ul className="space-y-1">
              {rules.map((r) => (
                <li key={r.id}>
                  <button onClick={() => setRuleId(r.id)} className={`w-full rounded px-2 py-1 text-left text-xs ${r.id === ruleId ? "bg-neutral-900 text-white" : "hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}>
                    {r.name}{r.isActive ? "" : " (inactiva)"}
                  </button>
                </li>
              ))}
            </ul>
          </aside>
        )}
        {mode === "resumen" && <ReglasResumen window={metricsWindow} onAbrir={(id) => { setRuleId(id); setMode("rule"); }} />}
        <div className={`relative flex-1 ${mode === "resumen" ? "hidden" : ""}`}>
          {mode === "rule" && !rule && (
            <div className="absolute inset-0 z-10 flex items-center justify-center p-6 text-sm text-neutral-500">
              Elige una regla de la lista para ver su flujo y cuántos contactos pasan por cada paso.
            </div>
          )}
          {mode === "rule" && sinDatos && (
            <div className="absolute left-3 top-3 z-10 rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-xs text-neutral-600 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
              Sin datos en la ventana: ningún contacto pasó por esta regla en {metricsWindow === "all" ? "el histórico" : `los últimos ${metricsWindow} días`}.
            </div>
          )}
          <ReactFlow
            nodes={shownNodes} edges={edges}
            onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
            onNodeDragStop={onNodeDragStop} onNodeClick={onNodeClick}
            onPaneClick={() => { if (mode === "general") setRuleId(null); }}
            nodesConnectable={false} nodesDraggable={mode === "general"} deleteKeyCode={null} fitView
            proOptions={{ hideAttribution: true }}
            edgeTypes={EDGE_TYPES} nodeTypes={NODE_TYPES}
          >
            <Background />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable />
            <FitOnChange token={`${mode}|${ruleId ?? ""}|${nodes.length}`} />
          </ReactFlow>
        </div>
        {mode === "general" && rule && (
          <aside className="w-80 shrink-0 overflow-y-auto border-l border-neutral-200 p-4 text-xs dark:border-neutral-800">
            <h2 className="text-sm font-semibold">{rule.name}</h2>
            <p className="mt-1 text-neutral-500">{rule.isActive ? "Activa" : "Pausada"}</p>
            {raw ? (
              <>
                <p className="mt-3 font-medium">{raw.total} contactos · {metricsWindow === "all" ? "histórico" : `${metricsWindow} días`}</p>
                {sinDatos && <p className="mt-1 text-neutral-500">Sin datos en la ventana.</p>}
                {!sinDatos && (
                  <ul className="mt-2 space-y-1">
                    {volumenes.map((v) => (
                      <li key={v.id} className="flex justify-between gap-2"><span className="truncate">{v.label}</span><span className="font-medium">{v.count}</span></li>
                    ))}
                  </ul>
                )}
              </>
            ) : <p className="mt-3 text-neutral-500">Cargando métricas…</p>}
            <div className="mt-4 flex flex-col gap-2">
              <button onClick={() => setMode("rule")} className="rounded-md border border-neutral-300 px-3 py-1 font-medium">Ver su flujo</button>
              <a href={editarHref(rule.id)} className="rounded-md border border-neutral-300 px-3 py-1 text-center font-medium">Editar en Configuración</a>
            </div>
          </aside>
        )}
        {slaOpen && (
          <div className="w-80 shrink-0 overflow-y-auto border-l border-neutral-200 p-4 dark:border-neutral-800">
            <h2 className="mb-3 text-sm font-semibold">Políticas SLA activas</h2>
            {slaRows.length === 0 && <p className="text-xs text-neutral-500">Sin políticas SLA activas.</p>}
            <ul className="space-y-3">
              {slaRows.map((s) => (
                <li key={s.id} className="rounded-md border border-neutral-200 p-3 text-xs dark:border-neutral-800">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{s.name}</span>
                    {s.isDefault && <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">default</span>}
                  </div>
                  <p className="mt-1 text-neutral-500">1er toque {s.firstTouchMinutes}min · reintento {s.retryMinutes}min · huérfano {s.orphanHours}h · prioridad {s.priority}</p>
                  <p className="mt-1 text-neutral-500">{s.conditionsSummary}</p>
                  <a href={`/configuracion?section=automation&slaId=${encodeURIComponent(s.id)}`} className="mt-2 inline-block font-medium text-neutral-900 underline dark:text-neutral-100">Editar →</a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <p className="border-t border-neutral-200 px-6 py-1.5 text-xs text-neutral-400 dark:border-neutral-800">
        Solo lectura. {mode === "general" ? "Haz clic en una regla para ver cuántos contactos pasan por ella; mueve los nodos para acomodar (el acomodo se guarda)." : "Cada nodo muestra cuántos contactos llegaron a ese paso."} Las reglas y cadencias se editan en Configuración → Automatización.
      </p>
    </div>
  );
}
