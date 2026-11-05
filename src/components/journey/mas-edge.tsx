"use client";
// Línea del lienzo de edición (J3): flecha, etiqueta de rama («Sí», «No»…) cerca del paso al que llega
// y un «+» al centro que abre el menú para insertar ahí (el menú lo pinta el editor, no la línea).
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from "@xyflow/react";

export interface DatosDeLinea {
  etiqueta?: string;
  /** Si no hay función, esa línea no admite inserciones y no muestra «+». */
  onAbrir?: (x: number, y: number) => void;
}

export function MasEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, data }: EdgeProps) {
  const [path, cx, cy] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const d = (data ?? {}) as DatosDeLinea;
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} />
      <EdgeLabelRenderer>
        {d.etiqueta && (
          <div
            style={{ position: "absolute", transform: `translate(-50%,-50%) translate(${targetX}px,${targetY - 20}px)`, pointerEvents: "none" }}
            className="nodrag nopan rounded-md border border-neutral-200 bg-white px-1.5 py-0.5 text-[11px] font-semibold text-neutral-700 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
          >
            {d.etiqueta}
          </div>
        )}
        {d.onAbrir && (
          <button
            type="button"
            style={{ position: "absolute", transform: `translate(-50%,-50%) translate(${cx}px,${cy}px)`, pointerEvents: "all" }}
            className="nodrag nopan flex h-5 w-5 items-center justify-center rounded-full border border-neutral-300 bg-white text-sm font-medium leading-none text-neutral-600 shadow-sm hover:border-neutral-900 hover:bg-neutral-900 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-300"
            onClick={(e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); d.onAbrir?.(r.left + r.width / 2, r.bottom + 4); }}
            aria-label="Agregar un paso aquí"
            title="Agregar un paso aquí"
          >
            +
          </button>
        )}
      </EdgeLabelRenderer>
    </>
  );
}
