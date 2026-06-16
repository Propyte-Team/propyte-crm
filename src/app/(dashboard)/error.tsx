"use client";

// Error boundary de todo el dashboard (MEJORA-01).
// Captura excepciones server-side de cualquier módulo bajo (dashboard)/ —commissions,
// cobranza, career, reports, etc.— y muestra "Reintentar" en vez de pantalla blanca.
// La causa más común es la BD reiniciándose (ver feedback_supabase_db_instability_pooler).

import { useEffect } from "react";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Dashboard error boundary:", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <p className="eyebrow">Algo salió mal</p>
      <h1 className="mt-2 text-[28px] font-bold leading-tight tracking-tight">
        No pudimos cargar esta sección
      </h1>
      <p className="mt-2 max-w-md text-[14px]" style={{ color: "var(--text-secondary)" }}>
        Suele ser temporal (la base de datos puede estar reiniciándose). Intenta de nuevo
        en unos segundos; si persiste, avisa al equipo.
      </p>
      <div className="mt-6 flex items-center gap-3">
        <button
          onClick={reset}
          className="rounded-lg px-4 py-2 text-[13px] font-semibold"
          style={{ background: "var(--text-primary)", color: "var(--bg-card)" }}
        >
          Reintentar
        </button>
        <a
          href="/hoy"
          className="rounded-lg border px-4 py-2 text-[13px] font-medium"
          style={{ borderColor: "var(--border-default)", color: "var(--text-primary)" }}
        >
          Ir a Hoy
        </a>
      </div>
      {error.digest && (
        <p className="num mt-4 text-[11px]" style={{ color: "var(--text-secondary)" }}>
          Ref: {error.digest}
        </p>
      )}
    </div>
  );
}
