"use client";

import { useState, useEffect, useCallback } from "react";

interface SyncStatus {
  last_sync: { sync_run_id: string; created_at: string } | null;
  api_calls_today: number;
  api_calls_limit: number;
  api_calls_remaining: number;
  pending_developments: number;
  total_mapped: Record<string, number>;
  table_counts: Record<string, number>;
  recent_errors: Array<{
    id: string;
    entity_type: string;
    operation: string;
    error_message: string;
    created_at: string;
    record_id?: string;
  }>;
}

export function ZohoSyncDashboard() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  const secret =
    typeof window !== "undefined"
      ? prompt("Ingresa el CRON_SECRET para acceder al dashboard:")
      : null;

  const fetchStatus = useCallback(async () => {
    if (!secret) return;
    try {
      const res = await fetch("/api/zoho/status", {
        headers: { Authorization: `Bearer ${secret}` },
      });
      if (res.ok) {
        setStatus(await res.json());
      }
    } catch (err) {
      console.error("Error fetching status:", err);
    } finally {
      setLoading(false);
    }
  }, [secret]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const triggerSync = async () => {
    if (!secret) return;
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/zoho/sync", {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}` },
      });
      const data = await res.json();
      if (res.ok) {
        setSyncResult(
          `Sync completado en ${data.duration_ms}ms — ` +
            `To Zoho: ${data.result.to_zoho.created}c/${data.result.to_zoho.updated}u/${data.result.to_zoho.errors}e | ` +
            `From Zoho: ${data.result.from_zoho.created}c/${data.result.from_zoho.updated}u/${data.result.from_zoho.errors}e`
        );
        fetchStatus();
      } else {
        setSyncResult(`Error: ${data.message || data.error}`);
      }
    } catch (err) {
      setSyncResult(`Error: ${err}`);
    } finally {
      setSyncing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Cargando status...</div>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-red-500">No se pudo cargar el status. Verifica el CRON_SECRET.</div>
      </div>
    );
  }

  const rateLimitPct = Math.round(
    ((status.api_calls_limit - status.api_calls_remaining) / status.api_calls_limit) * 100
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
            Zoho CRM Sync Monitor
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>
            Sync bidireccional Supabase ↔ Zoho cada 15 minutos
          </p>
        </div>
        <button
          onClick={triggerSync}
          disabled={syncing}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {syncing ? "Sincronizando..." : "Sync Manual"}
        </button>
      </div>

      {/* Sync Result Banner */}
      {syncResult && (
        <div
          className={`rounded-lg border p-3 text-sm ${
            syncResult.startsWith("Error")
              ? "bg-red-50 border-red-200 text-red-700"
              : "bg-green-50 border-green-200 text-green-700"
          }`}
        >
          {syncResult}
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Last Sync */}
        <div className="rounded-lg border p-4" style={{ background: "var(--bg-base)" }}>
          <div className="text-sm" style={{ color: "var(--text-secondary)" }}>
            Último Sync
          </div>
          <div className="text-lg font-bold mt-1" style={{ color: "var(--text-primary)" }}>
            {status.last_sync
              ? new Date(status.last_sync.created_at).toLocaleString("es-MX", {
                  hour: "2-digit",
                  minute: "2-digit",
                  day: "numeric",
                  month: "short",
                })
              : "Nunca"}
          </div>
        </div>

        {/* API Rate Limit */}
        <div className="rounded-lg border p-4" style={{ background: "var(--bg-base)" }}>
          <div className="text-sm" style={{ color: "var(--text-secondary)" }}>
            API Calls Hoy
          </div>
          <div className="text-lg font-bold mt-1" style={{ color: "var(--text-primary)" }}>
            {status.api_calls_today} / {status.api_calls_limit}
          </div>
          <div className="w-full bg-gray-200 rounded-full h-1.5 mt-2">
            <div
              className={`h-1.5 rounded-full ${
                rateLimitPct > 80 ? "bg-red-500" : rateLimitPct > 50 ? "bg-amber-500" : "bg-green-500"
              }`}
              style={{ width: `${rateLimitPct}%` }}
            />
          </div>
        </div>

        {/* Pending */}
        <div className="rounded-lg border p-4" style={{ background: "var(--bg-base)" }}>
          <div className="text-sm" style={{ color: "var(--text-secondary)" }}>
            Pendientes de Sync
          </div>
          <div className={`text-lg font-bold mt-1 ${status.pending_developments > 0 ? "text-amber-600" : "text-green-600"}`}>
            {status.pending_developments}
          </div>
        </div>

        {/* Total Mapped */}
        <div className="rounded-lg border p-4" style={{ background: "var(--bg-base)" }}>
          <div className="text-sm" style={{ color: "var(--text-secondary)" }}>
            Registros Mapeados
          </div>
          <div className="text-lg font-bold mt-1" style={{ color: "var(--text-primary)" }}>
            {Object.values(status.total_mapped).reduce((a, b) => a + b, 0)}
          </div>
        </div>
      </div>

      {/* Table Counts */}
      <div className="rounded-lg border p-4" style={{ background: "var(--bg-base)" }}>
        <h2 className="font-semibold mb-3" style={{ color: "var(--text-primary)" }}>
          Registros por Entidad
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Object.entries(status.table_counts).map(([table, count]) => (
            <div key={table} className="text-center">
              <div className="text-2xl font-bold text-blue-600">{count}</div>
              <div className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>
                {table.replace("Propyte_zoho_", "").replace(/_/g, " ")}
              </div>
            </div>
          ))}
          {Object.entries(status.total_mapped).map(([entity, count]) => (
            <div key={entity} className="text-center">
              <div className="text-2xl font-bold text-green-600">{count}</div>
              <div className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>
                {entity}s (mapeados)
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Recent Errors */}
      {status.recent_errors.length > 0 && (
        <div className="rounded-lg border p-4" style={{ background: "var(--bg-base)" }}>
          <h2 className="font-semibold mb-3 text-red-600">
            Errores Recientes (últimas 24h)
          </h2>
          <div className="space-y-2">
            {status.recent_errors.map((err) => (
              <div
                key={err.id}
                className="flex items-start gap-3 p-2 rounded bg-red-50 text-sm"
              >
                <span className="font-mono text-xs text-red-500 whitespace-nowrap">
                  {new Date(err.created_at).toLocaleTimeString("es-MX")}
                </span>
                <span className="font-medium text-red-700">{err.entity_type}</span>
                <span className="text-red-600 flex-1">{err.error_message}</span>
                {err.record_id && (
                  <span className="font-mono text-xs text-gray-400">{err.record_id.slice(0, 8)}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
