"use client";
// Flujos de las reglas (J2), de SOLO LECTURA, debajo del embudo: lista de reglas por paso del embudo
// y, al elegir una, su flujo de arriba hacia abajo (acomodo automático, esperas visibles, ramas con
// etiqueta) con los números de cada paso. Editar sigue siendo en Configuración → Reglas.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Background, Controls, Handle, MarkerType, MiniMap, Position, ReactFlow,
  type Edge, type Node, type NodeProps, type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { leerError } from "@/lib/api-errors";
import { ESTADO_LABELS } from "@/lib/estados";
import { CUALQUIER_MOMENTO, PASOS_EMBUDO, pasoDeRegla, type PasoDeRegla } from "@/lib/journey/embudo";
import { layoutFlow, TAMANO_POR_DEFECTO, TAMANOS_NODO } from "@/lib/journey/layout";
import { computeNodeMetrics, type NodeMetrics, type RawMetrics } from "@/lib/journey/node-metrics";
import { draftToReadFlow } from "@/lib/journey/read-flow";
import { ruleToDraft, type RuleRow } from "@/lib/journey/rule-draft";
import type { ResumenDeRegla } from "@/lib/journey/resumen-reglas";
import { FitOnChange, edgeLabel } from "./flow-nodes";

type Ventana = "7" | "30" | "90" | "all";
const VENTANAS: { valor: Ventana; texto: string }[] = [
  { valor: "7", texto: "Últimos 7 días" },
  { valor: "30", texto: "Últimos 30 días" },
  { valor: "90", texto: "Últimos 90 días" },
  { valor: "all", texto: "Todo el histórico" },
];

const SELECT = "rounded-md border border-neutral-300 bg-transparent px-2 py-1 text-xs dark:border-neutral-700";
const num = (n: number) => n.toLocaleString("es-MX");
const editarHref = (id: string) => `/configuracion?section=automation&ruleId=${encodeURIComponent(id)}`;

// ───────────────────────────── nodos del lienzo ─────────────────────────────

const ESTILO_NODO: Record<string, string> = {
  trigger: "border-blue-500 bg-blue-50 text-blue-950 dark:bg-blue-950/40 dark:text-blue-100",
  condition: "border-dashed border-neutral-400 bg-white dark:bg-neutral-900",
  action: "border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-900",
  stage: "border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-900",
  decision: "border-violet-500 bg-violet-50 text-violet-950 dark:bg-violet-950/40 dark:text-violet-100",
  wait: "rounded-full border-amber-400 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
  empty: "rounded-full border-dashed border-neutral-300 bg-transparent text-neutral-500",
};

function NodoLectura({ type, data }: NodeProps) {
  const d = data as { titulo?: string; texto?: string; volumen?: number };
  const t = TAMANOS_NODO[type] ?? TAMANO_POR_DEFECTO;
  const pastilla = type === "wait" || type === "empty";
  return (
    <div
      style={{ width: t.width, height: t.height }}
      className={`relative flex flex-col justify-center border px-3 text-xs shadow-sm ${pastilla ? "items-center" : "rounded-lg"} ${ESTILO_NODO[type] ?? ESTILO_NODO.action}`}
    >
      <Handle type="target" position={Position.Top} isConnectable={false} className="!h-1.5 !w-1.5 !border-0 !bg-neutral-400" />
      {!pastilla && d.titulo && <span className="text-[10px] font-semibold uppercase tracking-wide opacity-60">{d.titulo}</span>}
      <span className={pastilla ? "font-medium" : "line-clamp-2 text-[13px] font-medium leading-snug"}>{d.texto}</span>
      {typeof d.volumen === "number" && (
        <span className="absolute -top-2.5 right-2 rounded-full bg-neutral-900 px-2 py-0.5 text-[10px] font-medium text-white dark:bg-neutral-100 dark:text-neutral-900">
          Corrió {num(d.volumen)} {d.volumen === 1 ? "vez" : "veces"}
        </span>
      )}
      <Handle type="source" position={Position.Bottom} isConnectable={false} className="!h-1.5 !w-1.5 !border-0 !bg-neutral-400" />
    </div>
  );
}

// Referencia estable a nivel de módulo: React Flow no remonta nodos en cada render.
const NODE_TYPES: NodeTypes = {
  trigger: NodoLectura, condition: NodoLectura, action: NodoLectura, stage: NodoLectura,
  decision: NodoLectura, wait: NodoLectura, empty: NodoLectura,
};

// ───────────────────────────── lista de reglas ─────────────────────────────

interface Grupo { paso: PasoDeRegla; titulo: string; reglas: RuleRow[] }

function agruparPorPaso(reglas: RuleRow[]): Grupo[] {
  const porPaso = new Map<PasoDeRegla, RuleRow[]>();
  for (const r of reglas) {
    const p = pasoDeRegla(r);
    const lista = porPaso.get(p) ?? [];
    lista.push(r);
    porPaso.set(p, lista);
  }
  const orden: PasoDeRegla[] = [...PASOS_EMBUDO, CUALQUIER_MOMENTO];
  return orden
    .filter((p) => (porPaso.get(p)?.length ?? 0) > 0)
    .map((p) => ({ paso: p, titulo: p === CUALQUIER_MOMENTO ? "En cualquier momento" : ESTADO_LABELS[p], reglas: porPaso.get(p)! }));
}

function Punto({ activa }: { activa: boolean }) {
  return (
    <>
      <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${activa ? "bg-green-500" : "bg-neutral-400"}`} />
      <span className="sr-only">{activa ? "Encendida" : "Apagada"}</span>
    </>
  );
}

// ───────────────────────────── componente ─────────────────────────────

interface Props {
  /** Una pastilla del embudo pide abrir esta regla (`n` cambia en cada pedido). */
  abrirRegla?: { id: string; n: number } | null;
  /** Muestra «Editar en Configuración» (ADMIN/DIRECTOR). */
  puedeEditar?: boolean;
}

export function FlujosReglas({ abrirRegla = null, puedeEditar = false }: Props) {
  const searchParams = useSearchParams();
  const [reglas, setReglas] = useState<RuleRow[] | null>(null);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [intento, setIntento] = useState(0);
  const [ventana, setVentana] = useState<Ventana>("30");
  const [resumen, setResumen] = useState<Map<string, ResumenDeRegla> | null>(null);
  const [errorResumen, setErrorResumen] = useState(false);
  const [elegida, setElegida] = useState<string | null>(null);
  const [raw, setRaw] = useState<RawMetrics | null>(null);
  const [errorMetricas, setErrorMetricas] = useState(false);
  const [intentoMetricas, setIntentoMetricas] = useState(0);

  // Reglas. Si la carga falla se dice (con «Reintentar»): «Sin reglas» sería mentira.
  useEffect(() => {
    let cancel = false;
    setReglas(null);
    setErrorCarga(null);
    fetch("/api/admin/automation")
      .then(async (r) => {
        if (!r.ok) throw new Error(await leerError(r, "No se pudieron cargar las reglas."));
        return r.json();
      })
      .then((j) => { if (!cancel) setReglas(((j.data ?? j).rules ?? []) as RuleRow[]); })
      .catch((e: unknown) => { if (!cancel) setErrorCarga(e instanceof Error ? e.message : "No se pudieron cargar las reglas."); });
    return () => { cancel = true; };
  }, [intento]);

  // Números de «Todas las reglas» (una consulta agregada). Si falla, la lista sigue sirviendo.
  useEffect(() => {
    let cancel = false;
    setResumen(null);
    setErrorResumen(false);
    fetch(`/api/admin/journey/metrics/resumen?window=${ventana}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(await leerError(r, "No se pudieron cargar los números."));
        return r.json() as Promise<{ reglas: ResumenDeRegla[] }>;
      })
      .then((j) => { if (!cancel) setResumen(new Map(j.reglas.map((x) => [x.ruleId, x]))); })
      .catch(() => { if (!cancel) setErrorResumen(true); });
    return () => { cancel = true; };
  }, [ventana, intento]);

  // Enlace directo /journey?ruleId=… (una sola vez) y pedidos del embudo.
  const [enlaceAplicado, setEnlaceAplicado] = useState(false);
  useEffect(() => {
    if (!reglas || enlaceAplicado) return;
    setEnlaceAplicado(true);
    const id = searchParams.get("ruleId");
    if (id && reglas.some((r) => r.id === id)) setElegida(id);
  }, [reglas, enlaceAplicado, searchParams]);
  useEffect(() => {
    if (abrirRegla && reglas?.some((r) => r.id === abrirRegla.id)) setElegida(abrirRegla.id);
  }, [abrirRegla, reglas]);

  const regla = useMemo(() => reglas?.find((r) => r.id === elegida) ?? null, [reglas, elegida]);
  const draft = useMemo(() => (regla ? ruleToDraft(regla) : null), [regla]);

  // Números por paso de la regla elegida (la API los da por regla).
  useEffect(() => {
    if (!elegida) { setRaw(null); setErrorMetricas(false); return; }
    let cancel = false;
    setRaw(null);
    setErrorMetricas(false);
    fetch(`/api/admin/journey/metrics?ruleId=${encodeURIComponent(elegida)}&window=${ventana}`)
      .then((r) => { if (!r.ok) throw new Error(); return r.json() as Promise<RawMetrics>; })
      .then((j) => { if (!cancel) setRaw(j); })
      .catch(() => { if (!cancel) setErrorMetricas(true); });
    return () => { cancel = true; };
  }, [elegida, ventana, intentoMetricas]);

  const metricas: NodeMetrics | null = useMemo(() => (draft && raw ? computeNodeMetrics(draft, raw) : null), [draft, raw]);

  // El acomodo depende solo de la regla; los números se agregan aparte para no recalcularlo.
  const acomodo = useMemo(() => (draft ? layoutFlow(draftToReadFlow(draft)) : null), [draft]);
  const nodes: Node[] = useMemo(() => {
    if (!acomodo) return [];
    return acomodo.nodes.map((n) => {
      const vol = metricas && n.type !== "wait" && n.type !== "empty" ? metricas.nodeVolumes[n.id] ?? 0 : undefined;
      return { id: n.id, type: n.type, position: n.position, data: { ...n.data, ...(vol !== undefined ? { volumen: vol } : {}) } };
    });
  }, [acomodo, metricas]);
  const edges: Edge[] = useMemo(() => {
    if (!acomodo) return [];
    return acomodo.edges.map((e) => ({
      id: e.id, source: e.source, target: e.target, type: "smoothstep",
      label: edgeLabel(e, metricas),
      markerEnd: { type: MarkerType.ArrowClosed },
      labelStyle: { fontSize: 11, fontWeight: 600 },
      labelBgPadding: [6, 3] as [number, number],
      labelBgBorderRadius: 6,
    }));
  }, [acomodo, metricas]);

  const grupos = useMemo(() => (reglas ? agruparPorPaso(reglas) : []), [reglas]);
  const fila = elegida ? resumen?.get(elegida) : undefined;

  return (
    <section aria-labelledby="journey-flujos-titulo" className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="journey-flujos-titulo" className="text-lg font-semibold tracking-tight">Flujos de las reglas</h2>
        <p className="text-xs text-neutral-500">Qué hace cada regla, paso a paso.</p>
        <label className="ml-auto flex items-center gap-2 text-xs text-neutral-500">
          Periodo
          <select value={ventana} onChange={(e) => setVentana(e.target.value as Ventana)} className={SELECT}>
            {VENTANAS.map((v) => <option key={v.valor} value={v.valor}>{v.texto}</option>)}
          </select>
        </label>
      </div>

      {errorCarga && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
          {errorCarga}{" "}
          <button type="button" className="font-medium underline" onClick={() => setIntento((n) => n + 1)}>Reintentar</button>
        </div>
      )}
      {!errorCarga && !reglas && <p className="text-sm text-neutral-500">Cargando reglas…</p>}
      {reglas && reglas.length === 0 && (
        <p className="text-sm text-neutral-500">Todavía no hay reglas. Se crean en Configuración → Automatización.</p>
      )}

      {reglas && reglas.length > 0 && (
        <div className="flex flex-col gap-4 lg:flex-row">
          <aside aria-label="Reglas por paso" className="w-full shrink-0 lg:w-72">
            {errorResumen && (
              <p role="status" className="mb-2 text-xs text-amber-700 dark:text-amber-400">
                No se pudieron cargar los números de las reglas.{" "}
                <button type="button" className="underline" onClick={() => setIntento((n) => n + 1)}>Reintentar</button>
              </p>
            )}
            <div className="max-h-[560px] space-y-3 overflow-y-auto pr-1">
              {grupos.map((g) => (
                <div key={g.paso}>
                  <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{g.titulo}</h3>
                  <ul className="space-y-1">
                    {g.reglas.map((r) => {
                      const f = resumen?.get(r.id);
                      return (
                        <li key={r.id}>
                          <button
                            type="button"
                            onClick={() => setElegida(r.id)}
                            aria-current={r.id === elegida ? "true" : undefined}
                            className={`flex w-full flex-col gap-0.5 rounded-md border px-2.5 py-1.5 text-left text-sm ${
                              r.id === elegida
                                ? "border-neutral-900 bg-neutral-100 dark:border-neutral-100 dark:bg-neutral-800"
                                : "border-neutral-200 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900"
                            }`}
                          >
                            <span className="flex items-center gap-2 font-medium"><Punto activa={r.isActive} /><span className="truncate">{r.name}</span></span>
                            {f && (
                              <span className="pl-4 text-[11px] text-neutral-500">
                                {num(f.disparos)} {f.disparos === 1 ? "disparo" : "disparos"}
                                {f.fallidas > 0 && <span className="font-medium text-red-600"> · {num(f.fallidas)} {f.fallidas === 1 ? "falló" : "fallaron"}</span>}
                              </span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </aside>

          <div className="min-w-0 flex-1">
            {!regla && (
              <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500 dark:border-neutral-700">
                Elige una regla de la lista, o una pastilla del embudo, para ver su flujo.
              </div>
            )}
            {regla && (
              <div className="overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800">
                <header className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-neutral-200 px-4 py-2.5 dark:border-neutral-800">
                  <h3 className="flex items-center gap-2 text-sm font-semibold"><Punto activa={regla.isActive} />{regla.name}</h3>
                  <span className="text-xs text-neutral-500">{regla.isActive ? "Encendida" : "Apagada"}</span>
                  {fila && (
                    <span className="text-xs text-neutral-500">
                      Se disparó {num(fila.disparos)} · se completó {num(fila.completadas)} ·{" "}
                      <span className={fila.fallidas > 0 ? "font-medium text-red-600" : ""}>falló {num(fila.fallidas)}</span>
                    </span>
                  )}
                  {puedeEditar && (
                    <Link href={editarHref(regla.id)} className="ml-auto rounded-md border border-neutral-300 px-2.5 py-1 text-xs font-medium hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900">
                      Editar en Configuración
                    </Link>
                  )}
                </header>
                {errorMetricas && (
                  <p role="status" className="border-b border-neutral-200 px-4 py-1.5 text-xs text-amber-700 dark:border-neutral-800 dark:text-amber-400">
                    No se pudieron cargar los números de cada paso.{" "}
                    <button type="button" className="underline" onClick={() => setIntentoMetricas((n) => n + 1)}>Reintentar</button>
                  </p>
                )}
                <div className="h-[560px]" aria-label={`Flujo de la regla ${regla.name}`}>
                  <ReactFlow
                    nodes={nodes}
                    edges={edges}
                    nodeTypes={NODE_TYPES}
                    nodesDraggable={false}
                    nodesConnectable={false}
                    elementsSelectable={false}
                    fitView
                    fitViewOptions={{ padding: 0.15 }}
                    minZoom={0.2}
                    maxZoom={1.5}
                    proOptions={{ hideAttribution: true }}
                  >
                    <FitOnChange token={`${regla.id}:${nodes.length}`} />
                    <Background />
                    <Controls showInteractive={false} />
                    <MiniMap pannable zoomable />
                  </ReactFlow>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
