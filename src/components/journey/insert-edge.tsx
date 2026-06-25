"use client";
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from "@xyflow/react";

export function InsertEdge(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data } = props;
  const [path, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const onInsert = (data as { onInsert?: () => void } | undefined)?.onInsert;
  return (
    <>
      <BaseEdge id={id} path={path} />
      {onInsert && (
        <EdgeLabelRenderer>
          <button
            type="button"
            style={{
              position: "absolute",
              transform: `translate(-50%,-50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: "all",
            }}
            className="rounded-full border border-neutral-300 bg-white px-1.5 text-xs leading-none text-neutral-500 shadow-sm hover:bg-neutral-100"
            onClick={(e) => { e.stopPropagation(); onInsert(); }}
            aria-label="Insertar acción aquí"
          >
            ⊕
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
