"use client";

import { useCallback, useEffect, useState } from "react";
import { AdvisorSelect } from "@/components/shared/advisor-select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const METRIC_LABEL: Record<string, string> = {
  CAPTACIONES: "Captaciones",
  NEGOCIOS_CREADOS: "Negocios creados",
  COTIZACIONES_ENVIADAS: "Cotizaciones enviadas",
  ACTIVIDADES_COMPLETADAS: "Actividades completadas",
  NEGOCIOS_GANADOS: "Negocios ganados",
  MONTO_VENTA: "Monto de venta",
};
const METRICS = Object.keys(METRIC_LABEL);

interface Row {
  goal: { id: string; metric: string; target: number; currency: string | null };
  actual: number;
  pct: number;
  status: "met" | "on_track" | "behind";
}

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function fmt(n: number, currency?: string | null) {
  if (currency)
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(n);
  return new Intl.NumberFormat("es-MX").format(n);
}

const STATUS_COLOR: Record<string, string> = {
  met: "var(--text-primary)",
  on_track: "var(--text-secondary)",
  behind: "var(--color-error, #DC2626)",
};

export function MetasClient({
  canEdit,
  selfUserId,
}: {
  canEdit: boolean;
  selfUserId: string;
  role: string;
}) {
  const [period, setPeriod] = useState(currentMonth());
  const [userId, setUserId] = useState<string | null>(
    canEdit ? null : selfUserId
  );
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [fMetric, setFMetric] = useState("NEGOCIOS_CREADOS");
  const [fTarget, setFTarget] = useState("");
  const [fCurrency, setFCurrency] = useState("MXN");

  const load = useCallback(async () => {
    setLoading(true);
    const qs = new URLSearchParams({ period });
    const uid = canEdit ? userId : selfUserId;
    if (uid) qs.set("userId", uid);
    const res = await fetch(`/api/goals/scorecard?${qs.toString()}`);
    const json = await res.json();
    setRows(json.data ?? []);
    setLoading(false);
  }, [period, userId, canEdit, selfUserId]);

  useEffect(() => {
    load();
  }, [load]);

  async function createGoal() {
    if (!userId) {
      alert("Selecciona un asesor");
      return;
    }
    const res = await fetch("/api/goals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scope: "USER",
        userId,
        period,
        metric: fMetric,
        target: Number(fTarget),
        currency: fMetric === "MONTO_VENTA" ? fCurrency : undefined,
      }),
    });
    if (res.ok) {
      setOpen(false);
      setFTarget("");
      await load();
    } else {
      const j = await res.json();
      alert(j.error ?? "Error");
    }
  }

  async function removeGoal(id: string) {
    const res = await fetch(`/api/goals/${id}`, { method: "DELETE" });
    if (res.ok) await load();
  }

  return (
    <div className="space-y-5 p-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[color:var(--text-primary)]">
            Metas
          </h1>
          <p className="text-[13px] text-[color:var(--text-tertiary)]">
            Avance del mes contra meta
          </p>
        </div>
        <div className="flex items-end gap-2">
          <label className="text-[13px]">
            <span className="block text-[color:var(--text-tertiary)]">Mes</span>
            <input
              type="month"
              className="form-input text-[13px]"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
            />
          </label>
          {canEdit && (
            <label className="text-[13px]">
              <span className="block text-[color:var(--text-tertiary)]">
                Asesor
              </span>
              <AdvisorSelect value={userId} onChange={(v) => setUserId(v)} />
            </label>
          )}
          {canEdit && (
            <button
              className="btn-primary text-xs"
              onClick={() => setOpen(true)}
            >
              Nueva meta
            </button>
          )}
        </div>
      </div>

      {/* Scorecard table */}
      <div className="crm-card p-0 overflow-hidden">
        {loading ? (
          <p className="p-4 text-[13px] text-[color:var(--text-tertiary)]">
            Cargando…
          </p>
        ) : rows.length === 0 ? (
          <p className="p-4 text-[13px] text-[color:var(--text-tertiary)]">
            {canEdit && !userId
              ? "Selecciona un asesor para ver/fijar sus metas."
              : "Sin metas este mes."}
          </p>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr
                className="border-b text-left text-[color:var(--text-tertiary)]"
                style={{ borderColor: "var(--border-subtle)" }}
              >
                <th className="px-4 py-2">Métrica</th>
                <th className="px-4 py-2 text-right">Real</th>
                <th className="px-4 py-2 text-right">Meta</th>
                <th className="px-4 py-2">Avance</th>
                {canEdit && <th className="px-4 py-2"></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.goal.id}
                  className="border-b"
                  style={{ borderColor: "var(--border-subtle)" }}
                >
                  <td className="px-4 py-2">
                    {METRIC_LABEL[r.goal.metric] ?? r.goal.metric}
                    {r.goal.currency ? ` (${r.goal.currency})` : ""}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {fmt(
                      r.actual,
                      r.goal.metric === "MONTO_VENTA" ? r.goal.currency : null
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {fmt(
                      r.goal.target,
                      r.goal.metric === "MONTO_VENTA" ? r.goal.currency : null
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <div
                        className="h-1.5 w-24 rounded"
                        style={{ background: "var(--border-subtle)" }}
                      >
                        <div
                          className="h-1.5 rounded"
                          style={{
                            width: `${Math.min(r.pct, 100)}%`,
                            background: STATUS_COLOR[r.status],
                          }}
                        />
                      </div>
                      <span style={{ color: STATUS_COLOR[r.status] }}>
                        {r.pct}%
                      </span>
                    </div>
                  </td>
                  {canEdit && (
                    <td className="px-4 py-2 text-right">
                      <button
                        className="text-xs text-[color:var(--text-tertiary)] hover:underline"
                        onClick={() => removeGoal(r.goal.id)}
                      >
                        Borrar
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* New goal dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nueva meta</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <label className="block text-[13px]">
              <span className="text-[color:var(--text-tertiary)]">Métrica</span>
              <select
                className="form-input w-full text-[13px]"
                value={fMetric}
                onChange={(e) => setFMetric(e.target.value)}
              >
                {METRICS.map((m) => (
                  <option key={m} value={m}>
                    {METRIC_LABEL[m]}
                  </option>
                ))}
              </select>
            </label>
            {fMetric === "MONTO_VENTA" && (
              <label className="block text-[13px]">
                <span className="text-[color:var(--text-tertiary)]">
                  Moneda
                </span>
                <select
                  className="form-input w-full text-[13px]"
                  value={fCurrency}
                  onChange={(e) => setFCurrency(e.target.value)}
                >
                  <option value="MXN">MXN</option>
                  <option value="USD">USD</option>
                </select>
              </label>
            )}
            <label className="block text-[13px]">
              <span className="text-[color:var(--text-tertiary)]">
                Meta (target)
              </span>
              <input
                type="number"
                min="1"
                className="form-input w-full text-[13px]"
                value={fTarget}
                onChange={(e) => setFTarget(e.target.value)}
              />
            </label>
            <button
              className="btn-primary w-full text-sm"
              onClick={createGoal}
            >
              Guardar meta
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
