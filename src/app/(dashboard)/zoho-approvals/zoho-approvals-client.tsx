"use client";

import { useState, useEffect, useCallback } from "react";

// --- Types ---

interface Development {
  id: string;
  nombre_desarrollo: string;
  ciudad: string;
  estado: string;
  tipo_desarrollo: string;
  ext_precio_min_mxn: number | null;
  ext_precio_max_mxn: number | null;
  fotos_desarrollo: string[] | null;
  unidades_disponibles: number | null;
  ext_descripcion_es: string | null;
  latitud: number | null;
  longitud: number | null;
  brochure_pdf: string | null;
  ext_commission_rate: number | null;
  tour_virtual_desarrollo: string | null;
  zona: string | null;
  calle: string | null;
  etapa_construccion: string | null;
  unidades_totales: number | null;
  zoho_pipeline_status: string;
  zoho_record_id: string | null;
  zoho_last_synced_at: string | null;
  updated_at: string;
}

interface Unit {
  id: string;
  slug_unidad: string;
  ext_numero_unidad: string;
  tipo_unidad: string;
  ext_tipologia: string | null;
  recamaras: number | null;
  banos_completos: number | null;
  superficie_total_m2: number | null;
  piso_numero: number | null;
  precio_mxn: number | null;
  precio_usd: number | null;
  estado_unidad: string;
  fotos_unidad: string[] | null;
  descripcion_corta_unidad: string | null;
  plano_unidad: string | null;
  ext_tiene_alberca: boolean | null;
  id_desarrollo: string;
  zoho_record_id: string | null;
  zoho_last_synced_at: string | null;
  desarrollo_nombre: string;
  desarrollo_zoho_id: string | null;
  desarrollo_pipeline_status: string;
}

// --- Constants ---

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
  return PIPELINE_STATUSES.find((p) => p.value === status) ||
    { value: status, label: status, color: "bg-gray-100 text-gray-700" };
}

// --- Completeness Score ---

const DEV_FIELDS = [
  { key: "nombre_desarrollo", label: "Nombre", weight: 1 },
  { key: "ciudad", label: "Ciudad", weight: 1 },
  { key: "tipo_desarrollo", label: "Tipo", weight: 1 },
  { key: "ext_precio_min_mxn", label: "Precio", weight: 2 },
  { key: "fotos_desarrollo", label: "Fotos", weight: 2, isArray: true },
  { key: "ext_descripcion_es", label: "Descripción", weight: 2 },
  { key: "latitud", label: "Coordenadas", weight: 1 },
  { key: "zona", label: "Zona", weight: 1 },
  { key: "calle", label: "Dirección", weight: 1 },
  { key: "etapa_construccion", label: "Etapa", weight: 1 },
  { key: "unidades_disponibles", label: "Unidades disp.", weight: 1 },
  { key: "brochure_pdf", label: "Brochure", weight: 1 },
  { key: "ext_commission_rate", label: "Comisión", weight: 1 },
];

const UNIT_FIELDS = [
  { key: "ext_numero_unidad", label: "Número", weight: 1 },
  { key: "tipo_unidad", label: "Tipo", weight: 1 },
  { key: "recamaras", label: "Recámaras", weight: 1 },
  { key: "banos_completos", label: "Baños", weight: 1 },
  { key: "superficie_total_m2", label: "Superficie", weight: 2 },
  { key: "precio_mxn", label: "Precio MXN", weight: 2, alt: "precio_usd" },
  { key: "fotos_unidad", label: "Fotos", weight: 2, isArray: true },
  { key: "estado_unidad", label: "Status", weight: 1 },
  { key: "descripcion_corta_unidad", label: "Descripción", weight: 1 },
  { key: "piso_numero", label: "Piso", weight: 1 },
];

function calcCompleteness(record: Record<string, unknown>, fields: typeof DEV_FIELDS): { pct: number; filled: number; total: number; missing: string[] } {
  let totalWeight = 0;
  let filledWeight = 0;
  const missing: string[] = [];

  for (const f of fields) {
    totalWeight += f.weight;
    const val = record[f.key];
    const altVal = (f as { alt?: string }).alt ? record[(f as { alt: string }).alt] : null;
    const hasValue = (f as { isArray?: boolean }).isArray
      ? Array.isArray(val) && val.length > 0 && val.some((v: unknown) => v && String(v).length > 0)
      : (val != null && val !== "" && val !== 0) || (altVal != null && altVal !== "" && altVal !== 0);

    if (hasValue) {
      filledWeight += f.weight;
    } else {
      missing.push(f.label);
    }
  }

  return {
    pct: Math.round((filledWeight / totalWeight) * 100),
    filled: fields.filter((f) => {
      const val = record[f.key];
      const altVal = (f as { alt?: string }).alt ? record[(f as { alt: string }).alt] : null;
      return (f as { isArray?: boolean }).isArray
        ? Array.isArray(val) && val.length > 0
        : (val != null && val !== "" && val !== 0) || (altVal != null && altVal !== "");
    }).length,
    total: fields.length,
    missing,
  };
}

// --- Main Component ---

export function ZohoApprovalsClient() {
  const [activeTab, setActiveTab] = useState<"developments" | "units">("developments");
  const [developments, setDevelopments] = useState<Development[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterCity, setFilterCity] = useState("all");
  const [filterDev, setFilterDev] = useState("all");
  const [filterCompleteness, setFilterCompleteness] = useState(0); // min % completeness
  const [sortBy, setSortBy] = useState<"name" | "completeness" | "city">("completeness");
  const [search, setSearch] = useState("");
  const [updating, setUpdating] = useState(false);

  // Fetch data based on active tab
  const fetchData = useCallback(async () => {
    setLoading(true);
    setSelected(new Set());
    try {
      const res = await fetch(`/api/zoho/approvals?tab=${activeTab}`);
      if (res.ok) {
        const data = await res.json();
        if (activeTab === "developments") {
          setDevelopments(data.developments || []);
        } else {
          setUnits(data.units || []);
        }
      }
    } catch (err) {
      console.error("Error fetching:", err);
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Update development pipeline status
  const updateDevStatus = async (ids: string[], newStatus: string) => {
    setUpdating(true);
    try {
      const res = await fetch("/api/zoho/approvals", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, zoho_pipeline_status: newStatus, entity_type: "development" }),
      });
      if (res.ok) {
        setDevelopments((prev) =>
          prev.map((d) =>
            ids.includes(d.id)
              ? { ...d, zoho_pipeline_status: newStatus }
              : d
          )
        );
        setSelected(new Set());
      }
    } catch (err) {
      console.error("Error updating:", err);
    } finally {
      setUpdating(false);
    }
  };

  // --- Filter logic ---
  const devCities = [...new Set(developments.map((d) => d.ciudad).filter(Boolean))].sort();
  const unitDevNames = [...new Set(units.map((u) => u.desarrollo_nombre).filter(Boolean))].sort();

  // Add completeness to developments
  const devsWithScore = developments.map((d) => ({
    ...d,
    _completeness: calcCompleteness(d as unknown as Record<string, unknown>, DEV_FIELDS),
  }));

  const filteredDevs = devsWithScore
    .filter((d) => {
      if (filterStatus !== "all" && d.zoho_pipeline_status !== filterStatus) return false;
      if (filterCity !== "all" && d.ciudad !== filterCity) return false;
      if (d._completeness.pct < filterCompleteness) return false;
      if (search && !d.nombre_desarrollo?.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    })
    .sort((a, b) => {
      if (sortBy === "completeness") return b._completeness.pct - a._completeness.pct;
      if (sortBy === "city") return (a.ciudad || "").localeCompare(b.ciudad || "");
      return (a.nombre_desarrollo || "").localeCompare(b.nombre_desarrollo || "");
    });

  // Add completeness to units
  const unitsWithScore = units.map((u) => ({
    ...u,
    _completeness: calcCompleteness(u as unknown as Record<string, unknown>, UNIT_FIELDS),
  }));

  const filteredUnits = unitsWithScore
    .filter((u) => {
      if (filterStatus !== "all") {
        if (filterStatus === "synced" && !u.zoho_record_id) return false;
        if (filterStatus === "pending" && u.zoho_record_id) return false;
        if (filterStatus === "aprobado" && u.desarrollo_pipeline_status !== "aprobado" && u.desarrollo_pipeline_status !== "listo") return false;
      }
      if (filterDev !== "all" && u.desarrollo_nombre !== filterDev) return false;
      if (u._completeness.pct < filterCompleteness) return false;
      if (search && !u.slug_unidad?.toLowerCase().includes(search.toLowerCase()) &&
          !u.ext_numero_unidad?.toLowerCase().includes(search.toLowerCase()) &&
          !u.desarrollo_nombre?.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    })
    .sort((a, b) => {
      if (sortBy === "completeness") return b._completeness.pct - a._completeness.pct;
      if (sortBy === "name") return (a.slug_unidad || "").localeCompare(b.slug_unidad || "");
      return (a.desarrollo_nombre || "").localeCompare(b.desarrollo_nombre || "");
    });

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const filtered = activeTab === "developments" ? filteredDevs : filteredUnits;

  const toggleSelectAll = () => {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((d) => d.id)));
    }
  };

  // --- Stats ---
  const devStats = {
    total: developments.length,
    aprobados: developments.filter((d) => ["aprobado", "listo"].includes(d.zoho_pipeline_status)).length,
    synced: developments.filter((d) => d.zoho_record_id).length,
    pending: developments.filter((d) => ["aprobado", "listo"].includes(d.zoho_pipeline_status) && !d.zoho_record_id).length,
  };

  const unitStats = {
    total: units.length,
    devAprobados: units.filter((u) => ["aprobado", "listo"].includes(u.desarrollo_pipeline_status)).length,
    synced: units.filter((u) => u.zoho_record_id).length,
    pending: units.filter((u) => ["aprobado", "listo"].includes(u.desarrollo_pipeline_status) && !u.zoho_record_id).length,
  };

  const stats = activeTab === "developments" ? devStats : unitStats;

  // Reset filters when switching tabs
  const switchTab = (tab: "developments" | "units") => {
    setActiveTab(tab);
    setFilterStatus("all");
    setFilterCity("all");
    setFilterDev("all");
    setFilterCompleteness(0);
    setSortBy("completeness");
    setSearch("");
    setSelected(new Set());
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Cargando {activeTab === "developments" ? "desarrollos" : "propiedades"}...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
          Zoho CRM — Aprobación
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>
          Solo los desarrollos aprobados y sus unidades se sincronizan a Zoho CRM
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg p-1" style={{ background: "var(--bg-surface)" }}>
        <button
          onClick={() => switchTab("developments")}
          className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === "developments"
              ? "bg-white shadow text-blue-600"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          Desarrollos ({developments.length || "..."})
        </button>
        <button
          onClick={() => switchTab("units")}
          className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === "units"
              ? "bg-white shadow text-blue-600"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          Propiedades ({units.length || "..."})
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {activeTab === "developments" ? (
          <>
            <StatCard label="Total Desarrollos" value={devStats.total} color="text-gray-700" />
            <StatCard label="Aprobados" value={devStats.aprobados} color="text-green-600" />
            <StatCard label="Synced a Zoho" value={devStats.synced} color="text-blue-600" />
            <StatCard label="Pendientes de Sync" value={devStats.pending} color="text-amber-600" />
          </>
        ) : (
          <>
            <StatCard label="Total Propiedades" value={unitStats.total} color="text-gray-700" />
            <StatCard label="De Desarrollos Aprobados" value={unitStats.devAprobados} color="text-green-600" />
            <StatCard label="Synced a Zoho" value={unitStats.synced} color="text-blue-600" />
            <StatCard label="Pendientes de Sync" value={unitStats.pending} color="text-amber-600" />
          </>
        )}
      </div>

      {/* Filters + Bulk Actions */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder={activeTab === "developments" ? "Buscar desarrollo..." : "Buscar propiedad..."}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-md border px-3 py-2 text-sm"
          style={{ background: "var(--bg-base)" }}
        />

        {activeTab === "developments" ? (
          <>
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
              className="rounded-md border px-3 py-2 text-sm" style={{ background: "var(--bg-base)" }}>
              <option value="all">Todos los status</option>
              {PIPELINE_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <select value={filterCity} onChange={(e) => setFilterCity(e.target.value)}
              className="rounded-md border px-3 py-2 text-sm" style={{ background: "var(--bg-base)" }}>
              <option value="all">Todas las ciudades</option>
              {devCities.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </>
        ) : (
          <>
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
              className="rounded-md border px-3 py-2 text-sm" style={{ background: "var(--bg-base)" }}>
              <option value="all">Todas</option>
              <option value="aprobado">De desarrollo aprobado</option>
              <option value="synced">Synced a Zoho</option>
              <option value="pending">Pendientes de sync</option>
            </select>
            <select value={filterDev} onChange={(e) => setFilterDev(e.target.value)}
              className="rounded-md border px-3 py-2 text-sm" style={{ background: "var(--bg-base)" }}>
              <option value="all">Todos los desarrollos</option>
              {unitDevNames.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </>
        )}

        {/* Sort */}
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value as "name" | "completeness" | "city")}
          className="rounded-md border px-3 py-2 text-sm" style={{ background: "var(--bg-base)" }}>
          <option value="completeness">Ordenar: Más completos</option>
          <option value="name">Ordenar: Nombre A-Z</option>
          <option value="city">Ordenar: Ciudad</option>
        </select>

        {/* Min completeness filter */}
        <select value={filterCompleteness} onChange={(e) => setFilterCompleteness(Number(e.target.value))}
          className="rounded-md border px-3 py-2 text-sm" style={{ background: "var(--bg-base)" }}>
          <option value={0}>Completitud: Todos</option>
          <option value={25}>≥ 25% completo</option>
          <option value={50}>≥ 50% completo</option>
          <option value={75}>≥ 75% completo</option>
          <option value={90}>≥ 90% completo</option>
        </select>

        {selected.size > 0 && activeTab === "developments" && (
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-sm font-medium">{selected.size} seleccionados →</span>
            {PIPELINE_STATUSES.filter((s) =>
              ["aprobado", "listo", "pausa", "descartado"].includes(s.value)
            ).map((s) => (
              <button key={s.value} onClick={() => updateDevStatus([...selected], s.value)}
                disabled={updating}
                className={`rounded-md px-3 py-1.5 text-xs font-medium ${s.color} hover:opacity-80 disabled:opacity-50`}>
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
                <input type="checkbox"
                  checked={selected.size === filtered.length && filtered.length > 0}
                  onChange={toggleSelectAll} className="rounded" />
              </th>
              {activeTab === "developments" ? (
                <>
                  <th className="text-left px-3 py-3 font-medium">Desarrollo</th>
                  <th className="text-left px-3 py-3 font-medium">Ciudad</th>
                  <th className="text-left px-3 py-3 font-medium">Tipo</th>
                  <th className="text-right px-3 py-3 font-medium">Precio desde</th>
                  <th className="text-center px-3 py-3 font-medium">Completitud</th>
                  <th className="text-center px-3 py-3 font-medium">Pipeline</th>
                  <th className="text-center px-3 py-3 font-medium">Zoho</th>
                </>
              ) : (
                <>
                  <th className="text-left px-3 py-3 font-medium">Propiedad</th>
                  <th className="text-left px-3 py-3 font-medium">Desarrollo</th>
                  <th className="text-left px-3 py-3 font-medium">Tipo</th>
                  <th className="text-center px-3 py-3 font-medium">Rec.</th>
                  <th className="text-right px-3 py-3 font-medium">Precio</th>
                  <th className="text-center px-3 py-3 font-medium">Completitud</th>
                  <th className="text-center px-3 py-3 font-medium">Status</th>
                  <th className="text-center px-3 py-3 font-medium">Zoho</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {activeTab === "developments"
              ? filteredDevs.map((dev) => <DevelopmentRow key={dev.id} dev={dev} completeness={dev._completeness} selected={selected.has(dev.id)} onToggle={() => toggleSelect(dev.id)} onStatusChange={(s) => updateDevStatus([dev.id], s)} updating={updating} />)
              : filteredUnits.map((unit) => <UnitRow key={unit.id} unit={unit} completeness={unit._completeness} selected={selected.has(unit.id)} onToggle={() => toggleSelect(unit.id)} />)
            }
            {filtered.length === 0 && (
              <tr><td colSpan={9} className="px-3 py-8 text-center text-gray-500">No se encontraron resultados</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="text-xs text-gray-400">
        Mostrando {filtered.length} de {activeTab === "developments" ? developments.length : units.length} {activeTab === "developments" ? "desarrollos" : "propiedades"}
      </div>
    </div>
  );
}

// --- Sub-components ---

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-lg border p-4" style={{ background: "var(--bg-base)" }}>
      <div className="text-sm" style={{ color: "var(--text-secondary)" }}>{label}</div>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
    </div>
  );
}

interface CompletenessInfo { pct: number; filled: number; total: number; missing: string[] }

function DevelopmentRow({ dev, completeness, selected, onToggle, onStatusChange, updating }: {
  dev: Development; completeness: CompletenessInfo; selected: boolean; onToggle: () => void;
  onStatusChange: (status: string) => void; updating: boolean;
}) {
  const badge = getStatusBadge(dev.zoho_pipeline_status);
  return (
    <tr className={`border-b hover:opacity-90 ${selected ? "bg-blue-50" : ""}`}>
      <td className="px-3 py-3"><input type="checkbox" checked={selected} onChange={onToggle} className="rounded" /></td>
      <td className="px-3 py-3">
        <div className="flex items-center gap-2">
          {dev.fotos_desarrollo?.[0] && <img src={dev.fotos_desarrollo[0]} alt="" className="w-8 h-8 rounded object-cover" />}
          <span className="font-medium truncate max-w-[200px]">{dev.nombre_desarrollo}</span>
        </div>
      </td>
      <td className="px-3 py-3">{dev.ciudad || "—"}</td>
      <td className="px-3 py-3 capitalize">{dev.tipo_desarrollo || "—"}</td>
      <td className="px-3 py-3 text-right">
        {dev.ext_precio_min_mxn ? `$${(dev.ext_precio_min_mxn / 1_000_000).toFixed(1)}M` : "—"}
      </td>
      <td className="px-3 py-3 text-center">
        <CompletenessBar pct={completeness.pct} filled={completeness.filled} total={completeness.total} missing={completeness.missing} />
      </td>
      <td className="px-3 py-3 text-center">
        <select value={dev.zoho_pipeline_status} onChange={(e) => onStatusChange(e.target.value)}
          disabled={updating} className={`rounded-full px-2 py-0.5 text-xs font-medium border-0 ${badge.color}`}>
          {PIPELINE_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </td>
      <td className="px-3 py-3 text-center">
        <ZohoDot synced={!!dev.zoho_record_id} approved={["aprobado", "listo"].includes(dev.zoho_pipeline_status)} />
      </td>
    </tr>
  );
}

function UnitRow({ unit, completeness, selected, onToggle }: { unit: Unit; completeness: CompletenessInfo; selected: boolean; onToggle: () => void }) {
  const isDevApproved = ["aprobado", "listo"].includes(unit.desarrollo_pipeline_status);
  return (
    <tr className={`border-b hover:opacity-90 ${selected ? "bg-blue-50" : ""}`}>
      <td className="px-3 py-3"><input type="checkbox" checked={selected} onChange={onToggle} className="rounded" /></td>
      <td className="px-3 py-3">
        <div className="flex items-center gap-2">
          {unit.fotos_unidad?.[0] && <img src={unit.fotos_unidad[0]} alt="" className="w-8 h-8 rounded object-cover" />}
          <span className="font-medium truncate max-w-[180px]">{unit.ext_numero_unidad || unit.slug_unidad}</span>
        </div>
      </td>
      <td className="px-3 py-3">
        <div className="flex items-center gap-1">
          <span className="truncate max-w-[160px]">{unit.desarrollo_nombre}</span>
          {isDevApproved && <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500" title="Desarrollo aprobado" />}
        </div>
      </td>
      <td className="px-3 py-3 capitalize">{unit.tipo_unidad || "—"}</td>
      <td className="px-3 py-3 text-center">{unit.recamaras ?? "—"}</td>
      <td className="px-3 py-3 text-right">
        {unit.precio_mxn ? `$${(unit.precio_mxn / 1_000_000).toFixed(1)}M` : unit.precio_usd ? `$${(unit.precio_usd / 1000).toFixed(0)}K USD` : "—"}
      </td>
      <td className="px-3 py-3 text-center">
        <CompletenessBar pct={completeness.pct} filled={completeness.filled} total={completeness.total} missing={completeness.missing} />
      </td>
      <td className="px-3 py-3 text-center">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
          unit.estado_unidad === "disponible" ? "bg-green-100 text-green-700" :
          unit.estado_unidad === "apartada" ? "bg-yellow-100 text-yellow-700" :
          unit.estado_unidad === "vendida" ? "bg-red-100 text-red-700" :
          "bg-gray-100 text-gray-700"
        }`}>
          {unit.estado_unidad || "—"}
        </span>
      </td>
      <td className="px-3 py-3 text-center">
        <ZohoDot synced={!!unit.zoho_record_id} approved={isDevApproved} />
      </td>
    </tr>
  );
}

function CompletenessBar({ pct, filled, total, missing }: { pct: number; filled: number; total: number; missing: string[] }) {
  const color = pct >= 75 ? "bg-green-500" : pct >= 50 ? "bg-amber-500" : pct >= 25 ? "bg-orange-400" : "bg-red-400";
  const textColor = pct >= 75 ? "text-green-700" : pct >= 50 ? "text-amber-700" : pct >= 25 ? "text-orange-700" : "text-red-700";

  return (
    <div className="group relative flex items-center gap-2 min-w-[80px]" title={missing.length > 0 ? `Falta: ${missing.join(", ")}` : "Completo"}>
      <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-xs font-semibold ${textColor} w-8 text-right`}>{pct}%</span>
      {/* Tooltip on hover */}
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-50">
        <div className="bg-gray-900 text-white text-xs rounded-lg px-3 py-2 whitespace-nowrap shadow-lg">
          <div className="font-semibold mb-1">{filled}/{total} campos completos</div>
          {missing.length > 0 && (
            <div className="text-gray-300">Falta: {missing.join(", ")}</div>
          )}
        </div>
      </div>
    </div>
  );
}

function ZohoDot({ synced, approved }: { synced: boolean; approved: boolean }) {
  if (synced) return <span className="inline-block w-2 h-2 rounded-full bg-green-500" title="Synced a Zoho" />;
  if (approved) return <span className="inline-block w-2 h-2 rounded-full bg-amber-400" title="Pendiente de sync" />;
  return <span className="inline-block w-2 h-2 rounded-full bg-gray-300" title="No aprobado" />;
}
