"use client";
// Menú del «+» de una línea del lienzo (J3): Acción… (catálogo en español), Esperar… y Decisión.
// Flota sobre la pantalla (fixed) para que el zoom y los pasos del lienzo no lo tapen.
import { useEffect, useRef, useState } from "react";
import { DelayInput } from "@/components/config/cadence-editor";
import { paletaDeAcciones } from "./rule-inspector-model";

const PRESETS_ESPERA = [
  { label: "1 hora", minutes: 60 },
  { label: "1 día", minutes: 1440 },
  { label: "2 días", minutes: 2880 },
  { label: "1 semana", minutes: 10080 },
];

const ITEM = "w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent dark:hover:bg-neutral-800";

interface Props {
  x: number;
  y: number;
  /** Si no se puede esperar aquí, el motivo (la opción queda deshabilitada y lo explica). */
  motivoSinEspera: string | null;
  /** Minutos de la espera que ya hay en ese lugar (para precargarla). */
  esperaActual: number;
  onAccion: (type: string) => void;
  onEspera: (minutos: number) => void;
  onDecision: () => void;
  onCerrar: () => void;
}

export function InsertMenu({ x, y, motivoSinEspera, esperaActual, onAccion, onEspera, onDecision, onCerrar }: Props) {
  const [vista, setVista] = useState<"inicio" | "accion" | "espera">("inicio");
  const [minutos, setMinutos] = useState(esperaActual > 0 ? String(esperaActual) : "1440");
  const caja = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCerrar(); };
    window.addEventListener("keydown", onKey);
    caja.current?.querySelector<HTMLElement>("button")?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onCerrar]);

  const ancho = 272;
  const left = Math.max(8, Math.min(x - ancho / 2, (typeof window !== "undefined" ? window.innerWidth : 1200) - ancho - 8));
  const top = Math.max(8, Math.min(y, (typeof window !== "undefined" ? window.innerHeight : 800) - 120));
  const m = Number(minutos);

  return (
    <>
      <button type="button" aria-label="Cerrar menú" tabIndex={-1} className="fixed inset-0 z-40 cursor-default" onClick={onCerrar} />
      <div
        ref={caja}
        role="menu"
        aria-label="Agregar un paso"
        style={{ left, top, width: ancho }}
        className="fixed z-50 max-h-[70vh] overflow-y-auto rounded-md border border-neutral-200 bg-white p-2 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
      >
        {vista === "inicio" && (
          <div className="space-y-0.5">
            <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Agregar aquí</p>
            <button type="button" role="menuitem" className={ITEM} onClick={() => setVista("accion")}>Acción…</button>
            <button type="button" role="menuitem" className={ITEM} disabled={!!motivoSinEspera} onClick={() => setVista("espera")}>Esperar…</button>
            {motivoSinEspera && <p className="px-2 pb-1 text-[11px] text-neutral-500">{motivoSinEspera}</p>}
            <button type="button" role="menuitem" className={ITEM} onClick={onDecision}>Decisión (bifurca según condiciones)</button>
          </div>
        )}
        {vista === "accion" && (
          <div>
            <button type="button" className="mb-1 px-2 text-[11px] text-neutral-500 underline" onClick={() => setVista("inicio")}>Volver</button>
            {paletaDeAcciones().map((g) => (
              <div key={g.grupo} className="mb-2 last:mb-0">
                <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">{g.grupo}</p>
                {g.items.map((it) => (
                  <button key={it.type} type="button" role="menuitem" className={ITEM} onClick={() => onAccion(it.type)}>{it.label}</button>
                ))}
              </div>
            ))}
          </div>
        )}
        {vista === "espera" && (
          <div className="space-y-2 px-1 pb-1">
            <button type="button" className="px-1 text-[11px] text-neutral-500 underline" onClick={() => setVista("inicio")}>Volver</button>
            <p className="px-1 text-[12px] font-medium">¿Cuánto esperar antes del siguiente paso?</p>
            <DelayInput value={minutos} onChange={setMinutos} presets={PRESETS_ESPERA} emptyText="Elige cuánto esperar" />
            <button
              type="button"
              className="btn-secondary !min-h-0 !px-2.5 !py-1 !text-[12px]"
              disabled={!Number.isFinite(m) || m <= 0}
              onClick={() => onEspera(m)}
            >
              {esperaActual > 0 ? "Cambiar espera" : "Agregar espera"}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
