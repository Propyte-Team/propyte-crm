"use client";
// Editor de UNA regla sobre el lienzo vertical de /journey (J3). Mismo dibujo que la lectura
// (`draftToReadFlow` + `layoutFlow`), pero con «+» en cada línea, panel lateral por paso, validación
// visible y barra con Guardar / Descartar / Probar con un contacto / Encendida-Apagada.
// El acomodo se calcula siempre; no se arrastran pasos.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Background, Controls, MarkerType, ReactFlow, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { leerError } from "@/lib/api-errors";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/use-toast";
import { DelayInput } from "@/components/config/cadence-editor";
import { ProbarReglaPanel } from "@/components/config/probar-regla-panel";
import { useFuentes } from "@/components/config/use-fuentes";
import type { PayloadDeRegla } from "@/components/config/workflow-builder-model";
import { layoutFlow } from "@/lib/journey/layout";
import { computeNodeMetrics, type RawMetrics } from "@/lib/journey/node-metrics";
import { draftToReadFlow, textoEspera } from "@/lib/journey/read-flow";
import {
  ID_ESPERA_DISPARADOR, baseDeEspera, draftToRulePayload, esIdDeEspera, esperaDeArista,
  idDeNodoInsertado, idEsperaDe, isDecisionDraft, minutosDeEspera, puntoDeArista, type RuleRow,
} from "@/lib/journey/rule-draft";
import { validarBorrador } from "@/lib/journey/rule-validation";
import { FitOnChange, edgeLabel } from "./flow-nodes";
import { TIPOS_DE_LINEA, TIPOS_DE_PASO } from "./flow-pasos";
import { InsertMenu } from "./insert-menu";
import { RuleInspectorPanel } from "./rule-inspector-panel";
import { findNode } from "./rule-inspector-model";
import { useRuleDraft } from "./use-rule-draft";

interface Props {
  regla: RuleRow;
  /** Números por paso de la regla guardada (solo se muestran mientras no haya cambios sin guardar). */
  raw: RawMetrics | null;
  onSalir: () => void;
  onGuardada: (row: RuleRow) => void;
  onActivaCambiada: (id: string, isActive: boolean) => void;
}

const BTN = "rounded-md border border-neutral-300 px-3 py-1 text-xs font-medium hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-900";

function PanelDeEspera({ objetivo, minutos, onCambiar, onQuitar }: { objetivo: string; minutos: number; onCambiar: (m: number) => void; onQuitar: () => void }) {
  return (
    <aside className="crm-card !p-4 space-y-3 text-[12px]">
      <h3 className="text-[12px] font-semibold uppercase tracking-wider text-[color:var(--text-tertiary)]">Espera</h3>
      <p className="text-[13px] font-medium">{textoEspera(minutos)}</p>
      <p className="text-[11px] text-[color:var(--text-tertiary)]">
        {objetivo === "trigger"
          ? "La regla espera este tiempo desde que ocurre lo que la dispara, y luego revisa si se cumple el «Si»."
          : "Se espera este tiempo antes de hacer el paso que sigue."}
      </p>
      <div className="space-y-1">
        <span className="block text-[12px] font-medium text-[color:var(--text-secondary)]">Cuánto esperar</span>
        <DelayInput
          value={String(minutos)}
          onChange={(m) => { const n = Number(m); if (Number.isFinite(n) && n > 0) onCambiar(n); }}
          emptyText="Elige cuánto esperar"
        />
      </div>
      <button type="button" className="btn-secondary !min-h-0 !px-2.5 !py-1 !text-[12px]" onClick={onQuitar}>Quitar espera</button>
    </aside>
  );
}

export function RuleFlowEditor({ regla, raw, onSalir, onGuardada, onActivaCambiada }: Props) {
  const router = useRouter();
  const confirmar = useConfirm();
  const { fuentes, cargando: cargandoFuentes, error: errorFuentes } = useFuentes();
  const { draft, isDirty, saving, error, fieldErrors, load, lastSaved, ops, save, syncActive } = useRuleDraft();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ edgeId: string; x: number; y: number } | null>(null);
  const [probar, setProbar] = useState(false);
  const [cambiandoActiva, setCambiandoActiva] = useState(false);
  const [errorActiva, setErrorActiva] = useState<string | null>(null);

  // El borrador nace de la regla al abrir el editor (el padre lo remonta con `key` por regla).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(regla); }, []);

  // Aviso al salir con cambios sin guardar: cerrar/recargar la pestaña y enlaces internos.
  useEffect(() => {
    if (!isDirty) return;
    const antes = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    const clic = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      e.preventDefault();
      e.stopPropagation();
      void confirmar({
        titulo: "Hay cambios sin guardar",
        descripcion: "Si te vas ahora se pierde lo que cambiaste en esta regla.",
        confirmar: "Salir sin guardar",
        cancelar: "Seguir editando",
        peligroso: true,
      }).then((ok) => { if (ok) router.push(`${url.pathname}${url.search}${url.hash}`); });
    };
    window.addEventListener("beforeunload", antes);
    document.addEventListener("click", clic, true);
    return () => {
      window.removeEventListener("beforeunload", antes);
      document.removeEventListener("click", clic, true);
    };
  }, [isDirty, confirmar, router]);

  const validacion = useMemo(
    () => (draft ? validarBorrador(draft, cargandoFuentes || errorFuentes ? undefined : fuentes) : null),
    [draft, fuentes, cargandoFuentes, errorFuentes],
  );
  const flow = useMemo(
    () => (draft ? layoutFlow(draftToReadFlow(draft, { edicion: true }), { separacionY: 84 }) : null),
    [draft],
  );
  const metricas = useMemo(() => (draft && raw && !isDirty ? computeNodeMetrics(draft, raw) : null), [draft, raw, isDirty]);
  const seleccion = flow && selectedId && flow.nodes.some((n) => n.id === selectedId) ? selectedId : null;

  const nodes: Node[] = useMemo(() => {
    if (!flow || !validacion) return [];
    return flow.nodes.map((n) => {
      const sinNumero = n.type === "wait" || n.type === "empty" || n.type === "fin";
      const vol = metricas && !sinNumero ? metricas.nodeVolumes[n.id] ?? 0 : undefined;
      return {
        id: n.id, type: n.type, position: n.position, draggable: false,
        data: {
          ...n.data,
          problema: validacion.porNodo[n.id],
          seleccionado: n.id === seleccion,
          abrible: n.type !== "fin" && n.type !== "empty",
          ...(vol !== undefined ? { volumen: vol } : {}),
        },
      };
    });
  }, [flow, validacion, metricas, seleccion]);

  const edges: Edge[] = useMemo(() => {
    if (!flow || !draft) return [];
    return flow.edges.map((e) => {
      const punto = puntoDeArista(draft, e);
      return {
        id: e.id, source: e.source, target: e.target, type: "mas",
        markerEnd: { type: MarkerType.ArrowClosed },
        data: {
          etiqueta: edgeLabel(e, metricas),
          onAbrir: punto ? (x: number, y: number) => setMenu({ edgeId: e.id, x, y }) : undefined,
        },
      };
    });
  }, [flow, draft, metricas]);

  const aristaDelMenu = menu && flow ? flow.edges.find((e) => e.id === menu.edgeId) ?? null : null;
  const datosDelMenu = useMemo(() => {
    if (!draft || !aristaDelMenu) return null;
    const punto = puntoDeArista(draft, aristaDelMenu);
    const espera = esperaDeArista(draft, aristaDelMenu);
    return {
      punto,
      espera,
      actual: espera.ok ? minutosDeEspera(draft, espera.objetivo) : 0,
    };
  }, [draft, aristaDelMenu]);

  const cerrarMenu = useCallback(() => setMenu(null), []);

  const quitar = useCallback(async (id: string) => {
    if (!draft) return;
    const n = findNode(draft.actions, id);
    const conHijos = !!n && isDecisionDraft(n) && (n.branches.some((b) => b.steps.length > 0) || (n.else?.length ?? 0) > 0);
    if (conHijos && !(await confirmar({
      titulo: "¿Quitar la decisión?",
      descripcion: "También se quitan los pasos que tiene dentro de sus ramas.",
      confirmar: "Quitar",
      peligroso: true,
    }))) return;
    ops.removeNode(id);
    setSelectedId(null);
  }, [draft, confirmar, ops]);

  const opsPanel = useMemo(() => ({
    ...ops,
    // Al cambiar de disparador se conserva su espera (no forma parte de lo que se elige).
    setTrigger: (t: { triggerType: string; triggerConfig: Record<string, unknown> }) =>
      ops.setTriggerConEspera(t),
    // La espera de una acción se guarda siempre igual, venga del panel o de la línea.
    setActionDelay: (id: string, m: number) => ops.setEspera(id, m),
    removeNode: (id: string) => { void quitar(id); },
    reorderAction: (id: string, dir: "up" | "down") => {
      ops.reorderAction(id, dir);
      const m = /^a(\d+)$/.exec(id);
      if (m) setSelectedId(`a${Number(m[1]) + (dir === "up" ? -1 : 1)}`);
    },
  }), [ops, quitar]);

  const payload = useMemo(() => (draft ? (draftToRulePayload(draft) as unknown as PayloadDeRegla) : null), [draft]);

  const guardar = useCallback(async () => {
    if (!draft || !validacion?.ok) return;
    if (draft.isActive && !(await confirmar({
      titulo: "Esta regla está encendida",
      descripcion: "Los cambios aplican a los contactos que entren desde ahora.",
      confirmar: "Guardar cambios",
    }))) return;
    const ok = await save();
    if (ok && lastSaved.current) {
      onGuardada(lastSaved.current);
      toast({ title: "Regla guardada" });
      onSalir();
    }
  }, [draft, validacion, confirmar, save, lastSaved, onGuardada, onSalir]);

  const descartar = useCallback(async () => {
    if (isDirty && !(await confirmar({
      titulo: "¿Descartar los cambios?",
      descripcion: "Se pierde lo que cambiaste en esta regla.",
      confirmar: "Descartar",
      cancelar: "Seguir editando",
      peligroso: true,
    }))) return;
    onSalir();
  }, [isDirty, confirmar, onSalir]);

  const alternarActiva = useCallback(async () => {
    if (!draft?.id) return;
    const nuevo = !draft.isActive;
    if (nuevo && !(await confirmar({
      titulo: "¿Encender esta regla?",
      descripcion: isDirty
        ? "Se enciende la regla como está guardada; tus cambios sin guardar todavía no cuentan."
        : "Empezará a correr con los contactos que cumplan lo que dice.",
      confirmar: "Encender",
    }))) return;
    setCambiandoActiva(true);
    setErrorActiva(null);
    try {
      const res = await fetch("/api/admin/automation", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "rule", id: draft.id, isActive: nuevo }),
      });
      if (!res.ok) { setErrorActiva(await leerError(res, "No se pudo cambiar el estado de la regla.")); return; }
      syncActive(nuevo);
      onActivaCambiada(draft.id, nuevo);
    } catch {
      setErrorActiva("No se pudo cambiar el estado de la regla: sin conexión.");
    } finally {
      setCambiandoActiva(false);
    }
  }, [draft, isDirty, confirmar, syncActive, onActivaCambiada]);

  if (!draft || !flow || !validacion) return <div className="p-6 text-sm text-neutral-500">Cargando…</div>;

  const faltantes = validacion.faltantes;
  const camposConError = Object.entries(fieldErrors);
  const esEspera = seleccion !== null && esIdDeEspera(seleccion);
  const objetivoEspera = esEspera && seleccion ? baseDeEspera(seleccion) : null;
  const decisionSeleccionada = seleccion && !esEspera ? findNode(draft.actions, seleccion) : undefined;

  return (
    <div className="overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800">
      <header className="flex flex-wrap items-center gap-2 border-b border-neutral-200 px-4 py-2.5 dark:border-neutral-800">
        <h3 className="mr-auto min-w-0 truncate text-sm font-semibold">Editando: {draft.name || "Regla sin nombre"}</h3>
        {isDirty && <span className="text-xs text-amber-600">● Cambios sin guardar</span>}
        <button
          type="button"
          role="switch"
          aria-checked={draft.isActive}
          onClick={alternarActiva}
          disabled={cambiandoActiva || !draft.id}
          className={`${BTN} flex items-center gap-2`}
          title={draft.isActive ? "Apagar la regla" : "Encender la regla"}
        >
          <span aria-hidden className={`h-2 w-2 rounded-full ${draft.isActive ? "bg-green-500" : "bg-neutral-400"}`} />
          {cambiandoActiva ? "Guardando…" : draft.isActive ? "Encendida" : "Apagada"}
        </button>
        <button type="button" className={`${BTN} ${probar ? "bg-neutral-100 dark:bg-neutral-800" : ""}`} aria-pressed={probar} onClick={() => setProbar((v) => !v)}>
          Probar con un contacto
        </button>
        <button type="button" className={BTN} onClick={descartar} disabled={saving}>Descartar</button>
        <button
          type="button"
          onClick={guardar}
          disabled={!isDirty || saving || !validacion.ok}
          aria-describedby={faltantes.length > 0 ? "journey-faltantes" : undefined}
          className="rounded-md bg-neutral-900 px-3 py-1 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
        >
          {saving ? "Guardando…" : "Guardar"}
        </button>
      </header>

      {faltantes.length > 0 && (
        <div id="journey-faltantes" role="status" className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <p className="font-medium">Para poder guardar falta:</p>
          <ul className="list-disc pl-4">{faltantes.map((f) => <li key={f}>{f}</li>)}</ul>
        </div>
      )}
      {(error || errorActiva || camposConError.length > 0) && (
        <div role="alert" className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
          {error && <p>{error}</p>}
          {errorActiva && <p>{errorActiva}</p>}
          {camposConError.length > 0 && <ul className="list-disc pl-4">{camposConError.map(([k, m]) => <li key={k}>{k}: {m}</li>)}</ul>}
        </div>
      )}

      <div className="flex flex-col lg:flex-row">
        <div className="h-[620px] min-w-0 flex-1" aria-label={`Editor de la regla ${draft.name}`}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={TIPOS_DE_PASO}
            edgeTypes={TIPOS_DE_LINEA}
            nodesDraggable={false}
            nodesConnectable={false}
            deleteKeyCode={null}
            zoomOnDoubleClick={false}
            onNodeClick={(_e, n) => { if (n.type !== "fin" && n.type !== "empty") setSelectedId(n.id); }}
            onPaneClick={() => setSelectedId(null)}
            fitView
            fitViewOptions={{ padding: 0.15 }}
            minZoom={0.2}
            maxZoom={1.5}
            proOptions={{ hideAttribution: true }}
          >
            <FitOnChange token={`${regla.id}:${nodes.length}`} />
            <Background />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
        <div className="max-h-[620px] w-full shrink-0 space-y-3 overflow-y-auto border-t border-neutral-200 p-3 dark:border-neutral-800 lg:w-80 lg:border-l lg:border-t-0">
          {objetivoEspera ? (
            <PanelDeEspera
              objetivo={objetivoEspera}
              minutos={minutosDeEspera(draft, objetivoEspera)}
              onCambiar={(m) => ops.setEspera(objetivoEspera, m)}
              onQuitar={() => { ops.setEspera(objetivoEspera, 0); setSelectedId(null); }}
            />
          ) : (
            <>
              <RuleInspectorPanel draft={draft} selectedId={seleccion} ops={opsPanel} sinActiva />
              {decisionSeleccionada && isDecisionDraft(decisionSeleccionada) && (
                <button type="button" className="btn-secondary !min-h-0 !px-2.5 !py-1 !text-[12px]" onClick={() => { void quitar(decisionSeleccionada.nodeId); }}>
                  Quitar paso
                </button>
              )}
            </>
          )}
        </div>
      </div>
      <p className="border-t border-neutral-200 px-4 py-1.5 text-xs text-neutral-500 dark:border-neutral-800">
        Haz clic en un paso para editarlo. Usa el «+» de las líneas para agregar una acción, una espera o una decisión. El acomodo es automático.
      </p>

      {probar && payload && (
        <div className="border-t border-neutral-200 p-3 dark:border-neutral-800">
          <ProbarReglaPanel regla={payload} fuentes={fuentes} />
        </div>
      )}

      {menu && datosDelMenu?.punto && (
        <InsertMenu
          x={menu.x}
          y={menu.y}
          motivoSinEspera={datosDelMenu.espera.ok ? null : datosDelMenu.espera.motivo}
          esperaActual={datosDelMenu.actual}
          onCerrar={cerrarMenu}
          onAccion={(type) => {
            const p = datosDelMenu.punto!;
            ops.insertActionAt(p, type);
            setSelectedId(idDeNodoInsertado(p));
            cerrarMenu();
          }}
          onDecision={() => {
            const p = datosDelMenu.punto!;
            ops.insertDecisionAt(p);
            setSelectedId(idDeNodoInsertado(p));
            cerrarMenu();
          }}
          onEspera={(m) => {
            const r = datosDelMenu.espera;
            if (!r.ok) return;
            ops.setEspera(r.objetivo, m);
            setSelectedId(r.objetivo === "trigger" ? ID_ESPERA_DISPARADOR : idEsperaDe(r.objetivo));
            cerrarMenu();
          }}
        />
      )}
    </div>
  );
}

