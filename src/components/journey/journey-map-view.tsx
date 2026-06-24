"use client";
import { useEffect, useMemo, useState } from "react";
import { LIFECYCLE_LABELS, LIFECYCLE_COLORS } from "@/lib/constants";
import {
  buildGeneralView, buildTargetedView, extractCampaigns,
  type RuleLite, type PlanLite,
} from "@/lib/journey/journey-map";

type Mode = "general" | "targeted";

export function JourneyMapView() {
  const [rules, setRules] = useState<RuleLite[]>([]);
  const [plans, setPlans] = useState<PlanLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<Mode>("general");
  const [campaign, setCampaign] = useState<string>("");

  useEffect(() => {
    fetch("/api/admin/automation").then((r) => r.json()).then((j) => {
      const d = j.data ?? j;
      setRules((d.rules ?? []) as RuleLite[]);
      setPlans((d.plans ?? []) as PlanLite[]);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const campaigns = useMemo(() => extractCampaigns(rules), [rules]);
  const general = useMemo(() => buildGeneralView(rules, plans), [rules, plans]);
  const targeted = useMemo(() => buildTargetedView(rules, plans, { campaign: campaign || undefined }), [rules, plans, campaign]);

  if (loading) return <div className="p-8 text-sm text-neutral-500">Cargando mapa…</div>;
  if (!rules.length && !plans.length) {
    return (
      <div className="p-8 text-sm text-neutral-500">
        Sin reglas ni cadencias configuradas todavía. Créalas en Configuración → Automatización.
      </div>
    );
  }

  return (
    <div className="space-y-4 p-6">
      <header className="flex items-center gap-4">
        <h1 className="text-[28px] font-semibold tracking-tight">Mapa de Journey</h1>
        <div className="ml-auto flex items-center gap-2 text-sm">
          <div className="inline-flex rounded-md border border-neutral-300 dark:border-neutral-700 p-0.5">
            <button
              onClick={() => setMode("general")}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                mode === "general"
                  ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                  : "text-neutral-600 dark:text-neutral-400"
              }`}
            >
              General
            </button>
            <button
              onClick={() => setMode("targeted")}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                mode === "targeted"
                  ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                  : "text-neutral-600 dark:text-neutral-400"
              }`}
            >
              Dirigida
            </button>
          </div>
          {mode === "targeted" && (
            <select
              value={campaign}
              onChange={(e) => setCampaign(e.target.value)}
              className="rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent px-2 py-1 text-xs"
            >
              <option value="">— elige campaña —</option>
              {campaigns.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          )}
        </div>
      </header>

      {mode === "general" ? (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {general.lanes.map((lane) => (
            <div
              key={lane.stage}
              className="min-w-[180px] flex-shrink-0 rounded-lg border border-neutral-200 dark:border-neutral-800"
            >
              <div
                className="border-b border-neutral-200 dark:border-neutral-800 px-3 py-2 text-xs font-semibold uppercase tracking-wide"
                style={{ color: LIFECYCLE_COLORS[lane.stage] ?? "#6B7280" }}
              >
                {LIFECYCLE_LABELS[lane.stage] ?? "General / Sin etapa"}
              </div>
              <div className="space-y-2 p-2">
                {lane.rules.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => setMode("targeted")}
                    className={`block w-full rounded-md border border-neutral-200 dark:border-neutral-800 px-2 py-1.5 text-left text-xs transition-colors hover:border-neutral-400 dark:hover:border-neutral-600 ${
                      r.isActive ? "" : "opacity-50"
                    }`}
                  >
                    ⚡ {r.name}{!r.isActive && " · pausada"}
                  </button>
                ))}
                {lane.cadences.map((c) => (
                  <div
                    key={c.id}
                    className={`rounded-md border border-dashed border-neutral-200 dark:border-neutral-800 px-2 py-1.5 text-xs ${
                      c.isActive ? "" : "opacity-50"
                    }`}
                  >
                    ⟳ {c.name} · {c.stepCount} pasos{!c.isActive && " · pausada"}
                  </div>
                ))}
                {!lane.rules.length && !lane.cadences.length && (
                  <p className="px-1 text-[11px] text-neutral-400">—</p>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {!campaign && (
            <p className="text-sm text-neutral-500">Elige una campaña arriba para ver su flujo.</p>
          )}
          {campaign && !targeted.flows.length && (
            <p className="text-sm text-neutral-500">Ninguna regla referencia &ldquo;{campaign}&rdquo;.</p>
          )}
          {targeted.flows.map((flow, i) => (
            <div
              key={i}
              className="flex items-center gap-2 overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800 p-3"
            >
              {flow.map((node, j) => (
                <div key={j} className="flex items-center gap-2">
                  <span
                    className={[
                      "whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs",
                      node.kind === "trigger"
                        ? "bg-blue-600 text-white"
                        : node.kind === "stage"
                        ? "bg-teal-600 text-white"
                        : node.kind === "condition"
                        ? "border border-dashed border-neutral-400 dark:border-neutral-600"
                        : node.kind === "cadence"
                        ? "border border-dashed border-neutral-300 dark:border-neutral-700"
                        : "border border-neutral-300 dark:border-neutral-700",
                    ].join(" ")}
                  >
                    {node.label}
                  </span>
                  {j < flow.length - 1 && (
                    <span className="text-neutral-400 dark:text-neutral-600">→</span>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-neutral-400">
        Vista de solo lectura. Edita reglas y cadencias en Configuración → Automatización.
      </p>
    </div>
  );
}
