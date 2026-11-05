"use client";
// Pasos del lienzo vertical de /journey (J2 lectura y J3 edición): un mismo dibujo para el disparador,
// el «Si», las acciones, las decisiones, las esperas y los marcadores. En edición pueden venir
// seleccionados y con un «Falta …» en rojo (`data.problema`).
import { Handle, MarkerType, Position, type Edge, type NodeProps, type NodeTypes } from "@xyflow/react";
import { TAMANO_POR_DEFECTO, TAMANOS_NODO } from "@/lib/journey/layout";
import { MasEdge } from "./mas-edge";

const num = (n: number) => n.toLocaleString("es-MX");

const ESTILO_NODO: Record<string, string> = {
  trigger: "border-blue-500 bg-blue-50 text-blue-950 dark:bg-blue-950/40 dark:text-blue-100",
  condition: "border-dashed border-neutral-400 bg-white dark:bg-neutral-900",
  action: "border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-900",
  stage: "border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-900",
  decision: "border-violet-500 bg-violet-50 text-violet-950 dark:bg-violet-950/40 dark:text-violet-100",
  wait: "rounded-full border-amber-400 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
  empty: "rounded-full border-dashed border-neutral-300 bg-transparent text-neutral-500",
  fin: "rounded-full border-neutral-300 bg-neutral-100 text-neutral-500 dark:border-neutral-700 dark:bg-neutral-800",
};

export interface DatosDePaso {
  titulo?: string;
  texto?: string;
  volumen?: number;
  /** «Falta elegir una plantilla»: pinta el paso en rojo. */
  problema?: string;
  seleccionado?: boolean;
  /** En edición los pasos (menos el «Fin» y las ramas vacías) se pueden abrir con un clic. */
  abrible?: boolean;
}

function NodoPaso({ type, data }: NodeProps) {
  const d = data as DatosDePaso;
  const t = TAMANOS_NODO[type] ?? TAMANO_POR_DEFECTO;
  const pastilla = type === "wait" || type === "empty" || type === "fin";
  const rojo = !!d.problema;
  const borde = rojo ? "!border-red-500 !bg-red-50 !text-red-950 dark:!bg-red-950/30 dark:!text-red-100" : "";
  const anillo = d.seleccionado ? "ring-2 ring-neutral-900 ring-offset-1 dark:ring-neutral-100" : "";
  return (
    <div
      style={{ width: t.width, height: t.height }}
      className={`relative flex flex-col justify-center border px-3 text-xs shadow-sm ${pastilla ? "items-center" : "rounded-lg"} ${ESTILO_NODO[type] ?? ESTILO_NODO.action} ${borde} ${anillo} ${d.abrible ? "cursor-pointer" : ""}`}
      title={d.problema}
    >
      <Handle type="target" position={Position.Top} isConnectable={false} className="!h-1.5 !w-1.5 !border-0 !bg-neutral-400" />
      {!pastilla && d.titulo && <span className="text-[10px] font-semibold uppercase tracking-wide opacity-60">{d.titulo}</span>}
      <span className={pastilla ? "font-medium" : "line-clamp-2 text-[13px] font-medium leading-snug"}>{d.texto}</span>
      {rojo && !pastilla && <span className="truncate text-[11px] font-semibold text-red-700 dark:text-red-300">{d.problema}</span>}
      {rojo && pastilla && <span className="sr-only">{d.problema}</span>}
      {typeof d.volumen === "number" && (
        <span className="absolute -top-2.5 right-2 rounded-full bg-neutral-900 px-2 py-0.5 text-[10px] font-medium text-white dark:bg-neutral-100 dark:text-neutral-900">
          Corrió {num(d.volumen)} {d.volumen === 1 ? "vez" : "veces"}
        </span>
      )}
      <Handle type="source" position={Position.Bottom} isConnectable={false} className="!h-1.5 !w-1.5 !border-0 !bg-neutral-400" />
    </div>
  );
}

// Referencias estables a nivel de módulo: React Flow no remonta nodos ni líneas en cada render.
export const TIPOS_DE_PASO: NodeTypes = {
  trigger: NodoPaso, condition: NodoPaso, action: NodoPaso, stage: NodoPaso,
  decision: NodoPaso, wait: NodoPaso, empty: NodoPaso, fin: NodoPaso,
};
export const TIPOS_DE_LINEA = { mas: MasEdge };

/** Línea de lectura: con etiqueta de rama y flecha. */
export function lineaDeLectura(e: { id: string; source: string; target: string }, etiqueta: string | undefined): Edge {
  return {
    id: e.id, source: e.source, target: e.target, type: "smoothstep",
    label: etiqueta,
    markerEnd: { type: MarkerType.ArrowClosed },
    labelStyle: { fontSize: 11, fontWeight: 600 },
    labelBgPadding: [6, 3] as [number, number],
    labelBgBorderRadius: 6,
  };
}
