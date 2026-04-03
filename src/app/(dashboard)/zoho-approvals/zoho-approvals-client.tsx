"use client";

import { useState, useEffect, useCallback } from "react";

interface Development {
  id: string;
  nombre_desarrollo: string;
  ciudad: string;
  estado: string;
  tipo_desarrollo: string;
  ext_precio_min_mxn: number | null;
  fotos_desarrollo: string[] | null;
  unidades_disponibles: number | null;
  zoho_pipeline_status: string;
  zoho_record_id: string | null;
  zoho_last_synced_at: string | null;
  updated_at: string;
}

const PIPELINE_STATUSES = [
  { value: "discovery", label: "Discovery", color: "bg-gray-100 text-gray-700" },
  { value: "analisis", label: "En Análisis", color: "bg-blue-100 text-blue-700" },
  { value: "presentacion", label: "Presentación", color: "bg-purple-100 text-purple-700" },
  { value: "aprobado", label: "Aprobado", color: "bg-green-100 text-green-700" },
  { value: "listo", label: "Listo para Venta", color: "bg-emerald-100 text-emerald-800" },
  { value: "pausa", label: "En Pausa", color: "bg-yellow-100 text-yellow-700" },
  { value: "descartado", label: "Descartado", color: "bg-red-100 text-red-700" },
];

function getStatusBadge(status: string) {
  const s = PIPELINE_STATUSES.find((p) => p.value === status);
  return s || { value: status, label: status, color: "bg-gray-100 text-gray-700" };
}

export function ZohoApprovalsClient() {
  const [developments, setDevelopments] = useState<Development[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterCity, setFilterCity] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [updating, setUpdating] = useState(false);

  const fetchDevelopments = useCallback(async () => {
    try {
      const res = await fetch("/api/zoho/approvals");
      if (res.ok) {
        const data = await res.json();
        setDevelopments(data.developments || []);
      }
    } catch (err) {
      console.error("Error fetching developments:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDevelopments();
  }, [fetchDevelopments]);

  const updateStatus = async (ids: string[], newStatus: string) => {
    setUpdating(true);
    try {
      const res = await fetch("/api/zoho/approvals", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, zoho_pipeline_status: newStatus }),
      });
      if (res.ok) {
        setDevelopments((prev) =>
          prev.map((d) =>
            ids.includes(d.id)
              ? {
                  ...d,
                  zoho_pipeline_status: newStatus,
                  ...(newStatus === "aprobado" || newStatus === "listo"
                    ? { approved_at: new Date().toISOString() }
                    : {}),
                }
              : d
          )
        );
        setSelected(new Set());
      }
    } catch (err) {
      console.error("Error updating status:", err);
    } finally {
      setUpdating(false);
    }
  };

  // Filter logic
  const cities = [...new Set(developments.map((d) => d.ciudad).filter(Boolean))].sort();

  const filtered = developments.filter((d) => {
    if (filterStatus !== "all" && d.zoho_pipeline_status !== filterStatus) return false;
    if (filterCity !== "all" && d.ciudad !== filterCity) return false;
    if (search && !d.nombre_desarrollo?.toLowerCase().includes(search.toLowerCase()))
      return false;
    return true;
  });

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((d) => d.id)));
    }
  };

  // Stats
  const stats = {
    total: developments.length,
    aprobados: developments.filter((d) =>
      ["aprobado", "listo"].includes(d.zoho_pipeline_status)
    ).length,
    synced: developments.filter((d) => d.zoho_record_id).length,
    pending: developments.filter(
      (d) =>
        ["aprobado", "listo"].includes(d.zoho_pipeline_status) && !d.zoho_record_id
    ).length,
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Cargando desarrollos...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
            Zoho CRM — Aprobación de Desarrollos
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>
            Solo los desarrollos aprobados se sincronizan a Zoho CRM
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Total Desarrollos", value: stats.total, color: "text-gray-700" },
          { label: "Aprobados", value: stats.aprobados, color: "text-green-600" },
          { label: "Synced a Zoho", value: stats.synced, color: "text-blue-600" },
          { label: "Pendientes de Sync", value: stats.pending, color: "text-amber-600" },
        ].map((stat) => (
          <div
            key={stat.label}
            className="rounded-lg border p-4"
            style={{ background: "var(--bg-base)" }}
          >
            <div className="text-sm" style={{ color: "var(--text-secondary)" }}>
              {stat.label}
            </div>
            <div className={`text-2xl font-bold ${stat.color}`}>{stat.value}</div>
          </div>
        ))}
      </div>

      {/* Filters + Bulk Actions */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Buscar desarrollo..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-md border px-3 py-2 text-sm"
          style={{ background: "var(--bg-base)" }}
        />
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="rounded-md border px-3 py-2 text-sm"
          style={{ background: "var(--bg-base)" }}
        >
          <option value="all">Todos los status</option>
          {PIPELINE_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <select
          value={filterCity}
          onChange={(e) => setFilterCity(e.target.value)}
          className="rounded-md border px-3 py-2 text-sm"
          style={{ background: "var(--bg-base)" }}
        >
          <option value="all">Todas las ciudades</option>
          {cities.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        {selected.size > 0 && (
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-sm font-medium">
              {selected.size} seleccionados →
            </span>
            {PIPELINE_STATUSES.filter((s) =>
              ["aprobado", "listo", "pausa", "descartado"].includes(s.value)
            ).map((s) => (
              <button
                key={s.value}
                onClick={() => updateStatus([...selected], s.value)}
                disabled={updating}
                className={`rounded-md px-3 py-1.5 text-xs font-medium ${s.color} hover:opacity-80 disabled:opacity-50`}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Table */}
      <div className="rounded-lg border overflow-hidden" style={{ background: "var(--bg-base)" }}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b" style={{ background: "var(--bg-surface)" }}>
              <th className="w-10 px-3 py-3">
                <input
                  type="checkbox"
                  checked={selected.size === filtered.length && filtered.length > 0}
                  onChange={toggleSelectAll}
                  className="rounded"
                />
              </th>
              <th className="text-left px-3 py-3 font-medium">Desarrollo</th>
              <th className="text-left px-3 py-3 font-medium">Ciudad</th>
              <th className="text-left px-3 py-3 font-medium">Tipo</th>
              <th className="text-right px-3 py-3 font-medium">Precio desde</th>
              <th className="text-center px-3 py-3 font-medium">Unidades</th>
              <th className="text-center px-3 py-3 font-medium">Pipeline</th>
              <th className="text-center px-3 py-3 font-medium">Zoho</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((dev) => {
              const badge = getStatusBadge(dev.zoho_pipeline_status);
              return (
                <tr
                  key={dev.id}
                  className={`border-b hover:opacity-90 ${
                    selected.has(dev.id) ? "bg-blue-50" : ""
                  }`}
                >
                  <td className="px-3 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(dev.id)}
                      onChange={() => toggleSelect(dev.id)}
                      className="rounded"
                    />
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      {dev.fotos_desarrollo?.[0] && (
                        <img
                          src={dev.fotos_desarrollo[0]}
                          alt=""
                          className="w-8 h-8 rounded object-cover"
                        />
                      )}
                      <span className="font-medium truncate max-w-[200px]">
                        {dev.nombre_desarrollo}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-3">{dev.ciudad || "—"}</td>
                  <td className="px-3 py-3 capitalize">{dev.tipo_desarrollo || "—"}</td>
                  <td className="px-3 py-3 text-right">
                    {dev.ext_precio_min_mxn
                      ? `$${(dev.ext_precio_min_mxn / 1_000_000).toFixed(1)}M`
                      : "—"}
                  </td>
                  <td className="px-3 py-3 text-center">
                    {dev.unidades_disponibles ?? "—"}
                  </td>
                  <td className="px-3 py-3 text-center">
                    <select
                      value={dev.zoho_pipeline_status}
                      onChange={(e) => updateStatus([dev.id], e.target.value)}
                      disabled={updating}
                      className={`rounded-full px-2 py-0.5 text-xs font-medium border-0 ${badge.color}`}
                    >
                      {PIPELINE_STATUSES.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-3 text-center">
                    {dev.zoho_record_id ? (
                      <span className="inline-block w-2 h-2 rounded-full bg-green-500" title="Synced" />
                    ) : dev.zoho_pipeline_status === "aprobado" ||
                      dev.zoho_pipeline_status === "listo" ? (
                      <span
                        className="inline-block w-2 h-2 rounded-full bg-amber-400"
                        title="Pendiente de sync"
                      />
                    ) : (
                      <span className="inline-block w-2 h-2 rounded-full bg-gray-300" title="No aprobado" />
                    )}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-gray-500">
                  No se encontraron desarrollos
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="text-xs text-gray-400">
        Mostrando {filtered.length} de {developments.length} desarrollos
      </div>
    </div>
  );
}
