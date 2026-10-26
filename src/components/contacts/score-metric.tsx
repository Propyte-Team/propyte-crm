"use client";

// Celda «Score» de la barra de resumen del contacto, con el desglose del lead scoring
// (spec 2026-10-26-lead-scoring-design.md). En modo sombra muestra el score calculado con la
// marca «sombra»: es informativo y todavía no mueve CAPI, etapas ni ruteo.
import { useEffect, useRef, useState } from "react";

export interface ScoreGuardado {
  score: number | null;
  desglose: { regla: string; etiqueta: string; familia: string; puntos: number; veces?: number }[];
  motivo: string | null;
  calculadoAt: string;
  modeloVersion: number;
}

const FAMILIA_LABEL: Record<string, string> = {
  perfil: "Perfil",
  fuente: "Fuente",
  conversacion: "Conversación",
  web_citas: "Web y citas",
};

export function ScoreMetric({ scoreContacto, guardado, activo }: { scoreContacto: number; guardado: ScoreGuardado | null; activo: boolean }) {
  const [abierto, setAbierto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto) return;
    const cerrar = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setAbierto(false);
    };
    document.addEventListener("mousedown", cerrar);
    return () => document.removeEventListener("mousedown", cerrar);
  }, [abierto]);

  // Sin cálculo todavía (tabla sin migrar o el cron no ha pasado): la celda de siempre.
  if (!guardado) {
    return (
      <div className="px-4 py-3" style={{ background: "var(--bg-card)" }}>
        <p className="text-[11px] uppercase tracking-wider text-[color:var(--text-tertiary)]">Score</p>
        <p className="num mt-0.5 text-[15px] font-medium text-[color:var(--text-primary)]">{scoreContacto}</p>
      </div>
    );
  }

  const valor = guardado.score === null ? "—" : String(guardado.score);
  const familias = Object.keys(FAMILIA_LABEL)
    .map((f) => ({ f, lineas: guardado.desglose.filter((d) => d.familia === f) }))
    .filter((g) => g.lineas.length > 0);

  return (
    <div ref={ref} className="relative px-4 py-3" style={{ background: "var(--bg-card)" }}>
      <p className="text-[11px] uppercase tracking-wider text-[color:var(--text-tertiary)]">
        Score{!activo && <span className="ml-1 normal-case tracking-normal">(sombra)</span>}
      </p>
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className="num mt-0.5 text-[15px] font-medium text-[color:var(--text-primary)] underline decoration-dotted underline-offset-4"
        aria-expanded={abierto}
        title="¿Por qué este score?"
      >
        {valor}
      </button>

      {abierto && (
        <div
          className="absolute right-0 top-full z-20 mt-1 w-72 rounded-lg border p-3 text-[12px] shadow-lg"
          style={{ background: "var(--bg-card)", borderColor: "var(--border-default)" }}
        >
          <p className="mb-2 font-medium text-[color:var(--text-primary)]">¿Por qué este score?</p>
          {guardado.motivo && <p className="mb-2 text-[color:var(--text-secondary)]">{guardado.motivo}</p>}
          {familias.length === 0 && !guardado.motivo && (
            <p className="text-[color:var(--text-tertiary)]">Ninguna regla sumó puntos todavía.</p>
          )}
          {familias.map(({ f, lineas }) => (
            <div key={f} className="mb-2">
              <p className="text-[11px] uppercase tracking-wider text-[color:var(--text-tertiary)]">{FAMILIA_LABEL[f]}</p>
              {lineas.map((l) => (
                <div key={l.regla} className="flex justify-between gap-2 py-0.5">
                  <span className="text-[color:var(--text-secondary)]">
                    {l.etiqueta}
                    {l.veces && l.veces > 1 ? ` (×${l.veces})` : ""}
                  </span>
                  <span className="num text-[color:var(--text-primary)]">+{l.puntos}</span>
                </div>
              ))}
            </div>
          ))}
          <p className="mt-2 border-t pt-2 text-[11px] text-[color:var(--text-tertiary)]" style={{ borderColor: "var(--border-subtle)" }}>
            Topes por familia y decaimiento aplicados · modelo v{guardado.modeloVersion} ·{" "}
            {new Date(guardado.calculadoAt).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" })}
            {!activo && " · En sombra: aún no afecta CAPI, etapas ni ruteo."}
          </p>
        </div>
      )}
    </div>
  );
}
