"use client";

import { useEffect, useState } from "react";

const METRIC_LABEL: Record<string, string> = {
  CAPTACIONES: "Captaciones",
  NEGOCIOS_CREADOS: "Negocios creados",
  COTIZACIONES_ENVIADAS: "Cotizaciones",
  ACTIVIDADES_COMPLETADAS: "Actividades",
  NEGOCIOS_GANADOS: "Ganados",
  MONTO_VENTA: "Monto",
};
const STATUS_COLOR: Record<string, string> = {
  met: "var(--text-primary)", on_track: "var(--text-secondary)", behind: "var(--color-error, #DC2626)",
};

interface Row { goal: { id: string; metric: string; target: number }; actual: number; pct: number; status: string }

export function MiAvanceWidget() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const d = new Date();
    const period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    fetch(`/api/goals/scorecard?period=${period}`)
      .then((r) => r.json())
      .then((j) => setRows((j.data ?? []).slice(0, 3)))
      .catch(() => setRows([]))
      .finally(() => setLoaded(true));
  }, []);

  if (loaded && rows.length === 0) return null;

  return (
    <section className="crm-card p-4">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-[color:var(--text-tertiary)]">Mi avance del mes</h3>
      <div className="mt-3 space-y-2">
        {rows.map((r) => (
          <div key={r.goal.id} className="flex items-center justify-between gap-3 text-[13px]">
            <span className="text-[color:var(--text-secondary)]">{METRIC_LABEL[r.goal.metric] ?? r.goal.metric}</span>
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-20 rounded" style={{ background: "var(--border-subtle)" }}>
                <div className="h-1.5 rounded" style={{ width: `${Math.min(r.pct, 100)}%`, background: STATUS_COLOR[r.status] }} />
              </div>
              <span style={{ color: STATUS_COLOR[r.status] }}>{r.pct}%</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
