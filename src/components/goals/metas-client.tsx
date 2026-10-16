"use client";

import { useCallback, useEffect, useState } from "react";
import { AdvisorSelect } from "@/components/shared/advisor-select";
import type { AdvisorOptionUser } from "@/components/shared/advisor-options";
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

async function fetchRows(qs: URLSearchParams): Promise<Row[]> {
  try {
    const res = await fetch(`/api/goals/scorecard?${qs.toString()}`);
    const json = await res.json();
    return json.data ?? [];
  } catch {
    return [];
  }
}

function GoalsTable({
  rows,
  loading,
  empty,
  canDelete,
  onDelete,
}: {
  rows: Row[];
  loading: boolean;
  empty: string;
  canDelete: boolean;
  onDelete: (id: string) => void;
}) {
  if (loading)
    return (
      <p className="p-4 text-[13px] text-[color:var(--text-tertiary)]">
        Cargando…
      </p>
    );
  if (rows.length === 0)
    return (
      <p className="p-4 text-[13px] text-[color:var(--text-tertiary)]">
        {empty}
      </p>
    );
  return (
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
          {canDelete && <th className="px-4 py-2"></th>}
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
              {fmt(r.actual, r.goal.metric === "MONTO_VENTA" ? r.goal.currency : null)}
            </td>
            <td className="px-4 py-2 text-right">
              {fmt(r.goal.target, r.goal.metric === "MONTO_VENTA" ? r.goal.currency : null)}
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
                <span style={{ color: STATUS_COLOR[r.status] }}>{r.pct}%</span>
              </div>
            </td>
            {canDelete && (
              <td className="px-4 py-2 text-right">
                <button
                  className="text-xs text-[color:var(--text-tertiary)] hover:underline"
                  onClick={() => onDelete(r.goal.id)}
                >
                  Borrar
                </button>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Metas (#895). Dos bloques:
 *  · Empresa: todos los ven; solo ADMIN y DIRECTOR (`canEditCompany`) crean y borran.
 *  · Por persona: arranca en uno mismo. Quien fija metas (`canEdit`) elige a otra persona de su
 *    alcance; el resto solo ve las suyas. El servidor recorta igual aunque se cambie la URL.
 */
export function MetasClient({
  canEdit,
  canEditCompany,
  selfUser,
  advisorPlaza,
}: {
  canEdit: boolean;
  canEditCompany: boolean;
  selfUser: AdvisorOptionUser;
  advisorPlaza: string | null;
}) {
  const [period, setPeriod] = useState(currentMonth());
  const [userId, setUserId] = useState<string>(selfUser.id);
  const [companyRows, setCompanyRows] = useState<Row[]>([]);
  const [personRows, setPersonRows] = useState<Row[]>([]);
  const [loadingCompany, setLoadingCompany] = useState(true);
  const [loadingPerson, setLoadingPerson] = useState(true);
  const [dialogScope, setDialogScope] = useState<"COMPANY" | "USER" | null>(null);
  const [fMetric, setFMetric] = useState("NEGOCIOS_CREADOS");
  const [fTarget, setFTarget] = useState("");
  const [fCurrency, setFCurrency] = useState("MXN");

  const loadCompany = useCallback(async () => {
    setLoadingCompany(true);
    setCompanyRows(await fetchRows(new URLSearchParams({ period, scope: "COMPANY" })));
    setLoadingCompany(false);
  }, [period]);

  const loadPerson = useCallback(async () => {
    setLoadingPerson(true);
    const uid = canEdit ? userId : selfUser.id;
    setPersonRows(await fetchRows(new URLSearchParams({ period, userId: uid })));
    setLoadingPerson(false);
  }, [period, userId, canEdit, selfUser.id]);

  useEffect(() => {
    loadCompany();
  }, [loadCompany]);
  useEffect(() => {
    loadPerson();
  }, [loadPerson]);

  async function createGoal() {
    if (!dialogScope) return;
    const res = await fetch("/api/goals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scope: dialogScope,
        ...(dialogScope === "USER" ? { userId } : {}),
        period,
        metric: fMetric,
        target: Number(fTarget),
        currency: fMetric === "MONTO_VENTA" ? fCurrency : undefined,
      }),
    });
    if (res.ok) {
      const scope = dialogScope;
      setDialogScope(null);
      setFTarget("");
      await (scope === "COMPANY" ? loadCompany() : loadPerson());
    } else {
      const j = await res.json().catch(() => ({}));
      alert(j.error ?? "Error");
    }
  }

  async function removeGoal(id: string, scope: "COMPANY" | "USER") {
    const res = await fetch(`/api/goals/${id}`, { method: "DELETE" });
    if (res.ok) await (scope === "COMPANY" ? loadCompany() : loadPerson());
    else {
      const j = await res.json().catch(() => ({}));
      alert(j.error ?? "Error");
    }
  }

  const viendoAOtro = canEdit && userId !== selfUser.id;

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
        <label className="text-[13px]">
          <span className="block text-[color:var(--text-tertiary)]">Mes</span>
          <input
            type="month"
            className="form-input text-[13px]"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
          />
        </label>
      </div>

      {/* Empresa */}
      <section className="space-y-2">
        <div className="flex items-end justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[color:var(--text-tertiary)]">
            Metas de la empresa
          </h2>
          {canEditCompany && (
            <button
              className="btn-primary text-xs"
              onClick={() => setDialogScope("COMPANY")}
            >
              Nueva meta de empresa
            </button>
          )}
        </div>
        <div className="crm-card p-0 overflow-hidden">
          <GoalsTable
            rows={companyRows}
            loading={loadingCompany}
            empty="Sin metas de la empresa este mes."
            canDelete={canEditCompany}
            onDelete={(id) => removeGoal(id, "COMPANY")}
          />
        </div>
      </section>

      {/* Por persona */}
      <section className="space-y-2">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[color:var(--text-tertiary)]">
            {viendoAOtro ? "Metas del asesor" : "Mis metas"}
          </h2>
          {canEdit && (
            <div className="flex items-end gap-2">
              <label className="text-[13px]">
                <span className="block text-[color:var(--text-tertiary)]">
                  Asesor
                </span>
                <AdvisorSelect
                  value={userId}
                  onChange={(v) => setUserId(v ?? selfUser.id)}
                  self={selfUser}
                  plaza={advisorPlaza}
                />
              </label>
              <button
                className="btn-primary text-xs"
                onClick={() => setDialogScope("USER")}
              >
                Nueva meta
              </button>
            </div>
          )}
        </div>
        <div className="crm-card p-0 overflow-hidden">
          <GoalsTable
            rows={personRows}
            loading={loadingPerson}
            empty="Sin metas este mes."
            canDelete={canEdit}
            onDelete={(id) => removeGoal(id, "USER")}
          />
        </div>
      </section>

      {/* New goal dialog */}
      <Dialog open={dialogScope !== null} onOpenChange={(o) => !o && setDialogScope(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {dialogScope === "COMPANY" ? "Nueva meta de la empresa" : "Nueva meta"}
            </DialogTitle>
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
