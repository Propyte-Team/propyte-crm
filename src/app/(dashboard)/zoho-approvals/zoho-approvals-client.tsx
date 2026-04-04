"use client";

import { useState, useEffect, useCallback, Fragment } from "react";

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
  ext_publicado: boolean | null;
  id_desarrollo: string;
  zoho_record_id: string | null;
  zoho_last_synced_at: string | null;
  desarrollo_nombre: string;
  desarrollo_zoho_id: string | null;
  desarrollo_pipeline_status: string;
}

interface Developer {
  id: string;
  nombre_desarrollador: string;
  ext_slug_desarrollador: string | null;
  logo: string | null;
  sitio_web: string | null;
  telefono: string | null;
  email: string | null;
  descripcion: string | null;
  ext_descripcion_en: string | null;
  ext_ciudad: string | null;
  ext_estado: string | null;
  es_verificado: boolean | null;
  zoho_pipeline_status: string;
  zoho_record_id: string | null;
  zoho_last_synced_at: string | null;
  updated_at: string;
}

type TabType = "developers" | "developments" | "units";

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

const PAGE_SIZES = [20, 50, 100, 300, 500, 1000];

function getStatusBadge(status: string) {
  return PIPELINE_STATUSES.find((p) => p.value === status) ||
    { value: status, label: status, color: "bg-gray-100 text-gray-700" };
}

// --- Completeness Fields ---

interface FieldDef {
  key: string;
  label: string;
  weight: number;
  isArray?: boolean;
  alt?: string;
}

const DEVELOPER_FIELDS: FieldDef[] = [
  { key: "nombre_desarrollador", label: "Nombre", weight: 2 },
  { key: "logo", label: "Logo", weight: 1 },
  { key: "sitio_web", label: "Sitio Web", weight: 1 },
  { key: "telefono", label: "Teléfono", weight: 1 },
  { key: "email", label: "Email", weight: 1 },
  { key: "descripcion", label: "Descripción", weight: 2 },
  { key: "ext_ciudad", label: "Ciudad", weight: 1 },
  { key: "ext_estado", label: "Estado", weight: 1 },
];

const DEV_FIELDS: FieldDef[] = [
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

const UNIT_FIELDS: FieldDef[] = [
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

// --- Detail Sections (for expandable panels) ---

interface DetailField {
  key: string;
  label: string;
  zoho: boolean;
  web: boolean;
  isArray?: boolean;
}

const DEVELOPER_DETAIL_SECTIONS: { title: string; fields: DetailField[] }[] = [
  {
    title: "Datos de Empresa",
    fields: [
      { key: "nombre_desarrollador", label: "Nombre", zoho: true, web: true },
      { key: "ext_slug_desarrollador", label: "Slug", zoho: false, web: true },
      { key: "logo", label: "Logo", zoho: false, web: true },
      { key: "es_verificado", label: "Verificado", zoho: false, web: true },
    ],
  },
  {
    title: "Contacto",
    fields: [
      { key: "telefono", label: "Teléfono", zoho: true, web: true },
      { key: "email", label: "Email", zoho: true, web: true },
      { key: "sitio_web", label: "Sitio Web", zoho: true, web: true },
    ],
  },
  {
    title: "Ubicación",
    fields: [
      { key: "ext_ciudad", label: "Ciudad", zoho: true, web: true },
      { key: "ext_estado", label: "Estado", zoho: true, web: true },
    ],
  },
  {
    title: "Contenido",
    fields: [
      { key: "descripcion", label: "Descripción (ES)", zoho: true, web: true },
      { key: "ext_descripcion_en", label: "Descripción (EN)", zoho: false, web: true },
    ],
  },
];

const DEV_DETAIL_SECTIONS: { title: string; fields: DetailField[] }[] = [
  {
    title: "Datos Generales",
    fields: [
      { key: "nombre_desarrollo", label: "Nombre", zoho: true, web: true },
      { key: "ciudad", label: "Ciudad / Municipio", zoho: true, web: true },
      { key: "estado", label: "Estado", zoho: true, web: true },
      { key: "tipo_desarrollo", label: "Tipo", zoho: false, web: true },
      { key: "etapa_construccion", label: "Etapa", zoho: false, web: true },
    ],
  },
  {
    title: "Ubicación",
    fields: [
      { key: "zona", label: "Zona / Colonia", zoho: true, web: true },
      { key: "calle", label: "Dirección", zoho: true, web: true },
      { key: "latitud", label: "Latitud", zoho: false, web: true },
      { key: "longitud", label: "Longitud", zoho: false, web: true },
    ],
  },
  {
    title: "Comercial",
    fields: [
      { key: "ext_precio_min_mxn", label: "Precio mín. MXN", zoho: false, web: true },
      { key: "ext_precio_max_mxn", label: "Precio máx. MXN", zoho: false, web: true },
      { key: "ext_commission_rate", label: "Comisión %", zoho: true, web: false },
      { key: "unidades_disponibles", label: "Unidades disponibles", zoho: true, web: true },
      { key: "unidades_totales", label: "Unidades totales", zoho: false, web: true },
    ],
  },
  {
    title: "Media y Contenido",
    fields: [
      { key: "fotos_desarrollo", label: "Fotos", zoho: true, web: true, isArray: true },
      { key: "ext_descripcion_es", label: "Descripción", zoho: true, web: true },
      { key: "brochure_pdf", label: "Brochure / Sitio", zoho: true, web: true },
      { key: "tour_virtual_desarrollo", label: "Tour Virtual", zoho: false, web: true },
    ],
  },
];

const UNIT_DETAIL_SECTIONS: { title: string; fields: DetailField[] }[] = [
  {
    title: "Datos Generales",
    fields: [
      { key: "ext_numero_unidad", label: "Número de unidad", zoho: true, web: true },
      { key: "slug_unidad", label: "Slug", zoho: false, web: true },
      { key: "tipo_unidad", label: "Tipo", zoho: false, web: true },
      { key: "ext_tipologia", label: "Tipología", zoho: true, web: true },
      { key: "estado_unidad", label: "Estado", zoho: true, web: true },
    ],
  },
  {
    title: "Características",
    fields: [
      { key: "recamaras", label: "Recámaras", zoho: true, web: true },
      { key: "banos_completos", label: "Baños completos", zoho: true, web: true },
      { key: "superficie_total_m2", label: "Superficie (m²)", zoho: true, web: true },
      { key: "piso_numero", label: "Piso / Nivel", zoho: true, web: true },
      { key: "ext_tiene_alberca", label: "Alberca", zoho: true, web: true },
    ],
  },
  {
    title: "Precios",
    fields: [
      { key: "precio_mxn", label: "Precio MXN", zoho: true, web: true },
      { key: "precio_usd", label: "Precio USD", zoho: false, web: true },
    ],
  },
  {
    title: "Media y Contenido",
    fields: [
      { key: "fotos_unidad", label: "Fotos", zoho: true, web: true, isArray: true },
      { key: "plano_unidad", label: "Plano", zoho: false, web: true },
      { key: "descripcion_corta_unidad", label: "Descripción", zoho: false, web: true },
    ],
  },
];

// --- Completeness Calculator ---

function calcCompleteness(record: Record<string, unknown>, fields: FieldDef[]): { pct: number; filled: number; total: number; missing: string[] } {
  let totalWeight = 0;
  let filledWeight = 0;
  const missing: string[] = [];

  for (const f of fields) {
    totalWeight += f.weight;
    const val = record[f.key];
    const altVal = f.alt ? record[f.alt] : null;
    const hasValue = f.isArray
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
      const altVal = f.alt ? record[f.alt] : null;
      return f.isArray
        ? Array.isArray(val) && val.length > 0
        : (val != null && val !== "" && val !== 0) || (altVal != null && altVal !== "");
    }).length,
    total: fields.length,
    missing,
  };
}

// --- Main Component ---

export function ZohoApprovalsClient() {
  const [activeTab, setActiveTab] = useState<TabType>("developers");
  const [developers, setDevelopers] = useState<Developer[]>([]);
  const [developments, setDevelopments] = useState<Development[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterCity, setFilterCity] = useState("all");
  const [filterDev, setFilterDev] = useState("all");
  const [filterCompleteness, setFilterCompleteness] = useState(0);
  const [sortBy, setSortBy] = useState<"name" | "completeness" | "city">("completeness");
  const [search, setSearch] = useState("");
  const [updating, setUpdating] = useState(false);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState(50);
  const [currentPage, setCurrentPage] = useState(1);

  // Fetch data based on active tab
  const fetchData = useCallback(async () => {
    setLoading(true);
    setSelected(new Set());
    try {
      const res = await fetch(`/api/zoho/approvals?tab=${activeTab}`);
      if (res.ok) {
        const data = await res.json();
        if (activeTab === "developers") {
          setDevelopers(data.developers || []);
        } else if (activeTab === "developments") {
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

  // Update pipeline status (developments or developers)
  const updatePipelineStatus = async (ids: string[], newStatus: string, entityType: "development" | "developer") => {
    setUpdating(true);
    try {
      const res = await fetch("/api/zoho/approvals", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, zoho_pipeline_status: newStatus, entity_type: entityType }),
      });
      if (res.ok) {
        if (entityType === "development") {
          setDevelopments((prev) =>
            prev.map((d) => ids.includes(d.id) ? { ...d, zoho_pipeline_status: newStatus } : d)
          );
        } else {
          setDevelopers((prev) =>
            prev.map((d) => ids.includes(d.id) ? { ...d, zoho_pipeline_status: newStatus } : d)
          );
        }
        setSelected(new Set());
      }
    } catch (err) {
      console.error("Error updating:", err);
    } finally {
      setUpdating(false);
    }
  };

  // Toggle web publication for a unit
  const toggleWebApproval = async (unitId: string, value: boolean) => {
    try {
      const res = await fetch("/api/zoho/approvals", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [unitId], entity_type: "unit", action: "toggle_web", value }),
      });
      if (res.ok) {
        setUnits((prev) =>
          prev.map((u) => u.id === unitId ? { ...u, ext_publicado: value } : u)
        );
      }
    } catch (err) {
      console.error("Error toggling web:", err);
    }
  };

  // --- Filter logic ---
  const developerCities = [...new Set(developers.map((d) => d.ext_ciudad).filter((c): c is string => !!c))].sort();
  const devCities = [...new Set(developments.map((d) => d.ciudad).filter(Boolean))].sort();
  const unitDevNames = [...new Set(units.map((u) => u.desarrollo_nombre).filter(Boolean))].sort();

  // Developers with score
  const developersWithScore = developers.map((d) => ({
    ...d,
    _completeness: calcCompleteness(d as unknown as Record<string, unknown>, DEVELOPER_FIELDS),
  }));

  const filteredDevelopers = developersWithScore
    .filter((d) => {
      if (filterStatus !== "all" && d.zoho_pipeline_status !== filterStatus) return false;
      if (filterCity !== "all" && d.ext_ciudad !== filterCity) return false;
      if (d._completeness.pct < filterCompleteness) return false;
      if (search && !d.nombre_desarrollador?.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    })
    .sort((a, b) => {
      if (sortBy === "completeness") return b._completeness.pct - a._completeness.pct;
      if (sortBy === "city") return (a.ext_ciudad || "").localeCompare(b.ext_ciudad || "");
      return (a.nombre_desarrollador || "").localeCompare(b.nombre_desarrollador || "");
    });

  // Developments with score
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

  // Units with score
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

  // --- Pagination ---
  const currentFiltered = activeTab === "developers" ? filteredDevelopers : activeTab === "developments" ? filteredDevs : filteredUnits;
  const totalItems = currentFiltered.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedItems = currentFiltered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === paginatedItems.length && paginatedItems.length > 0) {
      setSelected(new Set());
    } else {
      setSelected(new Set(paginatedItems.map((d) => d.id)));
    }
  };

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [search, filterStatus, filterCity, filterDev, filterCompleteness, sortBy]);

  // --- Stats ---
  const developerStats = {
    total: developers.length,
    aprobados: developers.filter((d) => ["aprobado", "listo"].includes(d.zoho_pipeline_status)).length,
    synced: developers.filter((d) => d.zoho_record_id).length,
    pending: developers.filter((d) => ["aprobado", "listo"].includes(d.zoho_pipeline_status) && !d.zoho_record_id).length,
  };

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

  // Reset when switching tabs
  const switchTab = (tab: TabType) => {
    setActiveTab(tab);
    setFilterStatus("all");
    setFilterCity("all");
    setFilterDev("all");
    setFilterCompleteness(0);
    setSortBy("completeness");
    setSearch("");
    setSelected(new Set());
    setExpandedRow(null);
    setCurrentPage(1);
  };

  const tabLabel = activeTab === "developers" ? "desarrolladores" : activeTab === "developments" ? "desarrollos" : "propiedades";
  const colSpan = activeTab === "units" ? 9 : 8;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Cargando {tabLabel}...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
          Zoho CRM — Aprobaci&oacute;n
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>
          Aprueba desarrolladores, desarrollos y propiedades para sincronizar a Zoho CRM y el sitio web
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg p-1" style={{ background: "var(--bg-surface)" }}>
        {([
          { key: "developers" as TabType, label: "Desarrolladores", count: developers.length },
          { key: "developments" as TabType, label: "Desarrollos", count: developments.length },
          { key: "units" as TabType, label: "Propiedades", count: units.length },
        ]).map((tab) => (
          <button
            key={tab.key}
            onClick={() => switchTab(tab.key)}
            className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? "bg-white shadow text-blue-600"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {tab.label} ({tab.count || "..."})
          </button>
        ))}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {activeTab === "developers" ? (
          <>
            <StatCard label="Total Desarrolladores" value={developerStats.total} color="text-gray-700" />
            <StatCard label="Aprobados" value={developerStats.aprobados} color="text-green-600" />
            <StatCard label="Synced a Zoho" value={developerStats.synced} color="text-blue-600" />
            <StatCard label="Pendientes de Sync" value={developerStats.pending} color="text-amber-600" />
          </>
        ) : activeTab === "developments" ? (
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
          placeholder={`Buscar ${tabLabel}...`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-md border px-3 py-2 text-sm"
          style={{ background: "var(--bg-base)" }}
        />

        {activeTab === "developers" ? (
          <>
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
              className="rounded-md border px-3 py-2 text-sm" style={{ background: "var(--bg-base)" }}>
              <option value="all">Todos los status</option>
              {PIPELINE_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <select value={filterCity} onChange={(e) => setFilterCity(e.target.value)}
              className="rounded-md border px-3 py-2 text-sm" style={{ background: "var(--bg-base)" }}>
              <option value="all">Todas las ciudades</option>
              {developerCities.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </>
        ) : activeTab === "developments" ? (
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

        <select value={sortBy} onChange={(e) => setSortBy(e.target.value as "name" | "completeness" | "city")}
          className="rounded-md border px-3 py-2 text-sm" style={{ background: "var(--bg-base)" }}>
          <option value="completeness">Ordenar: Completitud</option>
          <option value="name">Ordenar: Nombre A-Z</option>
          <option value="city">Ordenar: Ciudad</option>
        </select>

        <select value={filterCompleteness} onChange={(e) => setFilterCompleteness(Number(e.target.value))}
          className="rounded-md border px-3 py-2 text-sm" style={{ background: "var(--bg-base)" }}>
          <option value={0}>Completitud: Todos</option>
          <option value={25}>{"\u2265"} 25%</option>
          <option value={50}>{"\u2265"} 50%</option>
          <option value={75}>{"\u2265"} 75%</option>
          <option value={90}>{"\u2265"} 90%</option>
        </select>

        {selected.size > 0 && activeTab !== "units" && (
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-sm font-medium">{selected.size} seleccionados {"\u2192"}</span>
            {PIPELINE_STATUSES.filter((s) =>
              ["aprobado", "listo", "pausa", "descartado"].includes(s.value)
            ).map((s) => (
              <button key={s.value}
                onClick={() => updatePipelineStatus([...selected], s.value, activeTab === "developments" ? "development" : "developer")}
                disabled={updating}
                className={`rounded-md px-3 py-1.5 text-xs font-medium ${s.color} hover:opacity-80 disabled:opacity-50`}>
                {s.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <div className="text-xs text-gray-500">
          {totalItems} {tabLabel} encontrados
        </div>
        <div className="flex items-center gap-3">
          <select
            value={pageSize}
            onChange={(e) => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}
            className="rounded-md border px-2 py-1.5 text-xs"
            style={{ background: "var(--bg-base)" }}
          >
            {PAGE_SIZES.map((s) => (
              <option key={s} value={s}>{s} por p&aacute;gina</option>
            ))}
          </select>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={safePage <= 1}
              className="rounded-md border px-2.5 py-1.5 text-sm font-medium disabled:opacity-30 hover:bg-gray-100"
              style={{ background: "var(--bg-base)" }}
            >
              {"\u2039"}
            </button>
            <span className="text-xs px-2 text-gray-600 min-w-[60px] text-center">
              {safePage} / {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage >= totalPages}
              className="rounded-md border px-2.5 py-1.5 text-sm font-medium disabled:opacity-30 hover:bg-gray-100"
              style={{ background: "var(--bg-base)" }}
            >
              {"\u203A"}
            </button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-lg border overflow-hidden" style={{ background: "var(--bg-base)" }}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b" style={{ background: "var(--bg-surface)" }}>
              <th className="w-10 px-3 py-3">
                <input type="checkbox"
                  checked={selected.size === paginatedItems.length && paginatedItems.length > 0}
                  onChange={toggleSelectAll} className="rounded" />
              </th>
              {activeTab === "developers" ? (
                <>
                  <th className="text-left px-3 py-3 font-medium">Desarrollador</th>
                  <th className="text-left px-3 py-3 font-medium">Ciudad</th>
                  <th className="text-left px-3 py-3 font-medium">Email</th>
                  <th className="text-center px-3 py-3 font-medium">Verificado</th>
                  <th className="text-center px-3 py-3 font-medium">Completitud</th>
                  <th className="text-center px-3 py-3 font-medium">Pipeline</th>
                  <th className="text-center px-3 py-3 font-medium">Zoho</th>
                </>
              ) : activeTab === "developments" ? (
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
            {activeTab === "developers"
              ? (paginatedItems as typeof filteredDevelopers).map((dev) => (
                  <Fragment key={dev.id}>
                    <DeveloperRow dev={dev} completeness={dev._completeness} selected={selected.has(dev.id)}
                      onToggle={() => toggleSelect(dev.id)} onStatusChange={(s) => updatePipelineStatus([dev.id], s, "developer")}
                      updating={updating} expanded={expandedRow === dev.id}
                      onExpand={() => setExpandedRow(expandedRow === dev.id ? null : dev.id)} />
                    {expandedRow === dev.id && (
                      <EntityDetailPanel sections={DEVELOPER_DETAIL_SECTIONS} record={dev as unknown as Record<string, unknown>}
                        colSpan={colSpan} zohoStatus={{ pipeline: dev.zoho_pipeline_status, recordId: dev.zoho_record_id, entityLabel: "Desarrollador" }} />
                    )}
                  </Fragment>
                ))
              : activeTab === "developments"
              ? (paginatedItems as typeof filteredDevs).map((dev) => (
                  <Fragment key={dev.id}>
                    <DevelopmentRow dev={dev} completeness={dev._completeness} selected={selected.has(dev.id)}
                      onToggle={() => toggleSelect(dev.id)} onStatusChange={(s) => updatePipelineStatus([dev.id], s, "development")}
                      updating={updating} expanded={expandedRow === dev.id}
                      onExpand={() => setExpandedRow(expandedRow === dev.id ? null : dev.id)} />
                    {expandedRow === dev.id && (
                      <EntityDetailPanel sections={DEV_DETAIL_SECTIONS} record={dev as unknown as Record<string, unknown>}
                        colSpan={colSpan} zohoStatus={{ pipeline: dev.zoho_pipeline_status, recordId: dev.zoho_record_id, entityLabel: "Desarrollo" }} />
                    )}
                  </Fragment>
                ))
              : (paginatedItems as typeof filteredUnits).map((unit) => (
                  <Fragment key={unit.id}>
                    <UnitRow unit={unit} completeness={unit._completeness} selected={selected.has(unit.id)}
                      onToggle={() => toggleSelect(unit.id)} expanded={expandedRow === unit.id}
                      onExpand={() => setExpandedRow(expandedRow === unit.id ? null : unit.id)} />
                    {expandedRow === unit.id && <UnitDetailPanel unit={unit} onToggleWeb={toggleWebApproval} />}
                  </Fragment>
                ))
            }
            {paginatedItems.length === 0 && (
              <tr><td colSpan={colSpan} className="px-3 py-8 text-center text-gray-500">No se encontraron resultados</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {totalItems > 0 && (
        <div className="text-xs text-gray-400">
          Mostrando {(safePage - 1) * pageSize + 1}&ndash;{Math.min(safePage * pageSize, totalItems)} de {totalItems} {tabLabel}
        </div>
      )}
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

// --- Row Components ---

interface ExpandableRowProps {
  completeness: CompletenessInfo;
  selected: boolean;
  onToggle: () => void;
  expanded: boolean;
  onExpand: () => void;
  updating: boolean;
  onStatusChange: (status: string) => void;
}

function DeveloperRow({ dev, ...props }: { dev: Developer } & ExpandableRowProps) {
  const badge = getStatusBadge(dev.zoho_pipeline_status);
  return (
    <tr className={`border-b hover:opacity-90 cursor-pointer ${props.selected ? "bg-blue-50" : ""} ${props.expanded ? "bg-blue-50/50" : ""}`} onClick={props.onExpand}>
      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" checked={props.selected} onChange={props.onToggle} className="rounded" />
      </td>
      <td className="px-3 py-3">
        <div className="flex items-center gap-2">
          <span className={`text-gray-400 text-xs transition-transform duration-200 ${props.expanded ? "rotate-90" : ""}`}>&#9654;</span>
          {dev.logo && <img src={dev.logo} alt="" className="w-8 h-8 rounded object-cover" />}
          <span className="font-medium truncate max-w-[200px] hover:text-blue-600">{dev.nombre_desarrollador}</span>
        </div>
      </td>
      <td className="px-3 py-3">{dev.ext_ciudad || "\u2014"}</td>
      <td className="px-3 py-3 truncate max-w-[160px]">{dev.email || "\u2014"}</td>
      <td className="px-3 py-3 text-center">
        {dev.es_verificado
          ? <span className="text-green-600 text-xs font-medium">{"\u2713"} S&iacute;</span>
          : <span className="text-gray-400 text-xs">No</span>
        }
      </td>
      <td className="px-3 py-3 text-center">
        <CompletenessBar {...props.completeness} />
      </td>
      <td className="px-3 py-3 text-center" onClick={(e) => e.stopPropagation()}>
        <select value={dev.zoho_pipeline_status} onChange={(e) => props.onStatusChange(e.target.value)}
          disabled={props.updating} className={`rounded-full px-2 py-0.5 text-xs font-medium border-0 ${badge.color}`}>
          {PIPELINE_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </td>
      <td className="px-3 py-3 text-center">
        <ZohoDot synced={!!dev.zoho_record_id} approved={["aprobado", "listo"].includes(dev.zoho_pipeline_status)} />
      </td>
    </tr>
  );
}

function DevelopmentRow({ dev, ...props }: { dev: Development } & ExpandableRowProps) {
  const badge = getStatusBadge(dev.zoho_pipeline_status);
  return (
    <tr className={`border-b hover:opacity-90 cursor-pointer ${props.selected ? "bg-blue-50" : ""} ${props.expanded ? "bg-blue-50/50" : ""}`} onClick={props.onExpand}>
      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" checked={props.selected} onChange={props.onToggle} className="rounded" />
      </td>
      <td className="px-3 py-3">
        <div className="flex items-center gap-2">
          <span className={`text-gray-400 text-xs transition-transform duration-200 ${props.expanded ? "rotate-90" : ""}`}>&#9654;</span>
          {dev.fotos_desarrollo?.[0] && <img src={dev.fotos_desarrollo[0]} alt="" className="w-8 h-8 rounded object-cover" />}
          <span className="font-medium truncate max-w-[200px] hover:text-blue-600">{dev.nombre_desarrollo}</span>
        </div>
      </td>
      <td className="px-3 py-3">{dev.ciudad || "\u2014"}</td>
      <td className="px-3 py-3 capitalize">{dev.tipo_desarrollo || "\u2014"}</td>
      <td className="px-3 py-3 text-right">
        {dev.ext_precio_min_mxn ? `$${(dev.ext_precio_min_mxn / 1_000_000).toFixed(1)}M` : "\u2014"}
      </td>
      <td className="px-3 py-3 text-center">
        <CompletenessBar {...props.completeness} />
      </td>
      <td className="px-3 py-3 text-center" onClick={(e) => e.stopPropagation()}>
        <select value={dev.zoho_pipeline_status} onChange={(e) => props.onStatusChange(e.target.value)}
          disabled={props.updating} className={`rounded-full px-2 py-0.5 text-xs font-medium border-0 ${badge.color}`}>
          {PIPELINE_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </td>
      <td className="px-3 py-3 text-center">
        <ZohoDot synced={!!dev.zoho_record_id} approved={["aprobado", "listo"].includes(dev.zoho_pipeline_status)} />
      </td>
    </tr>
  );
}

function UnitRow({ unit, completeness, selected, onToggle, expanded, onExpand }: {
  unit: Unit; completeness: CompletenessInfo; selected: boolean; onToggle: () => void;
  expanded: boolean; onExpand: () => void;
}) {
  const isDevApproved = ["aprobado", "listo"].includes(unit.desarrollo_pipeline_status);
  return (
    <tr className={`border-b hover:opacity-90 cursor-pointer ${selected ? "bg-blue-50" : ""} ${expanded ? "bg-blue-50/50" : ""}`} onClick={onExpand}>
      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" checked={selected} onChange={onToggle} className="rounded" />
      </td>
      <td className="px-3 py-3">
        <div className="flex items-center gap-2">
          <span className={`text-gray-400 text-xs transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}>&#9654;</span>
          {unit.fotos_unidad?.[0] && <img src={unit.fotos_unidad[0]} alt="" className="w-8 h-8 rounded object-cover" />}
          <span className="font-medium truncate max-w-[180px] hover:text-blue-600">{unit.ext_numero_unidad || unit.slug_unidad}</span>
        </div>
      </td>
      <td className="px-3 py-3">
        <div className="flex items-center gap-1">
          <span className="truncate max-w-[160px]">{unit.desarrollo_nombre}</span>
          {isDevApproved && <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500" title="Desarrollo aprobado" />}
        </div>
      </td>
      <td className="px-3 py-3 capitalize">{unit.tipo_unidad || "\u2014"}</td>
      <td className="px-3 py-3 text-center">{unit.recamaras ?? "\u2014"}</td>
      <td className="px-3 py-3 text-right">
        {unit.precio_mxn ? `$${(unit.precio_mxn / 1_000_000).toFixed(1)}M` : unit.precio_usd ? `$${(unit.precio_usd / 1000).toFixed(0)}K USD` : "\u2014"}
      </td>
      <td className="px-3 py-3 text-center">
        <CompletenessBar {...completeness} />
      </td>
      <td className="px-3 py-3 text-center">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
          unit.estado_unidad === "disponible" ? "bg-green-100 text-green-700" :
          unit.estado_unidad === "apartada" ? "bg-yellow-100 text-yellow-700" :
          unit.estado_unidad === "vendida" ? "bg-red-100 text-red-700" :
          "bg-gray-100 text-gray-700"
        }`}>
          {unit.estado_unidad || "\u2014"}
        </span>
      </td>
      <td className="px-3 py-3 text-center">
        <ZohoDot synced={!!unit.zoho_record_id} approved={isDevApproved} />
      </td>
    </tr>
  );
}

// --- Shared UI ---

function CompletenessBar({ pct, filled, total, missing }: CompletenessInfo) {
  const color = pct >= 75 ? "bg-green-500" : pct >= 50 ? "bg-amber-500" : pct >= 25 ? "bg-orange-400" : "bg-red-400";
  const textColor = pct >= 75 ? "text-green-700" : pct >= 50 ? "text-amber-700" : pct >= 25 ? "text-orange-700" : "text-red-700";

  return (
    <div className="group relative flex items-center gap-2 min-w-[80px]" title={missing.length > 0 ? `Falta: ${missing.join(", ")}` : "Completo"}>
      <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-xs font-semibold ${textColor} w-8 text-right`}>{pct}%</span>
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

function formatFieldValue(key: string, val: unknown): string {
  if (typeof val === "boolean") return val ? "S\u00ed" : "No";
  if (val == null || val === "" || val === 0) return "Sin datos";
  if ((key === "precio_mxn" || key === "ext_precio_min_mxn" || key === "ext_precio_max_mxn") && typeof val === "number")
    return `$${val.toLocaleString("es-MX")} MXN`;
  if (key === "precio_usd" && typeof val === "number")
    return `$${val.toLocaleString("en-US")} USD`;
  if (key === "superficie_total_m2" && typeof val === "number")
    return `${val.toLocaleString()} m\u00b2`;
  if (key === "ext_commission_rate" && typeof val === "number")
    return `${val}%`;
  if (Array.isArray(val))
    return val.length > 0 ? `${val.length} elemento${val.length > 1 ? "s" : ""}` : "Sin datos";
  if (typeof val === "number") return val.toLocaleString();
  return String(val);
}

function fieldHasValue(field: DetailField, record: Record<string, unknown>): boolean {
  const val = record[field.key];
  if (field.isArray) return Array.isArray(val) && val.length > 0;
  if (typeof val === "boolean") return true;
  return val != null && val !== "" && val !== 0;
}

function FieldGrid({ sections, record }: { sections: { title: string; fields: DetailField[] }[]; record: Record<string, unknown> }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-5 mb-6">
      {sections.map((section) => (
        <div key={section.title}>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">
            {section.title}
          </h4>
          <div className="space-y-2">
            {section.fields.map((field) => {
              const val = record[field.key];
              const hasVal = fieldHasValue(field, record);
              return (
                <div key={field.key} className="flex items-start gap-2 text-sm">
                  <span className={`mt-0.5 flex-shrink-0 ${hasVal ? "text-green-500" : "text-red-400"}`}>
                    {hasVal ? "\u2713" : "\u2717"}
                  </span>
                  <div className="flex-1 min-w-0">
                    <span className="text-gray-500">{field.label}: </span>
                    <span className={hasVal ? "font-medium text-gray-900" : "text-red-400 italic"}>
                      {formatFieldValue(field.key, val)}
                    </span>
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    {field.zoho && (
                      <span className={`w-4 h-4 rounded text-[9px] flex items-center justify-center font-bold ${hasVal ? "bg-orange-100 text-orange-600" : "bg-gray-100 text-gray-400"}`} title="Campo Zoho CRM">Z</span>
                    )}
                    {field.web && (
                      <span className={`w-4 h-4 rounded text-[9px] flex items-center justify-center font-bold ${hasVal ? "bg-blue-100 text-blue-600" : "bg-gray-100 text-gray-400"}`} title="Campo Sitio Web">W</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// --- Detail Panels ---

function EntityDetailPanel({ sections, record, colSpan, zohoStatus }: {
  sections: { title: string; fields: DetailField[] }[];
  record: Record<string, unknown>;
  colSpan: number;
  zohoStatus: { pipeline: string; recordId: string | null; entityLabel: string };
}) {
  const zohoFields = sections.flatMap((s) => s.fields.filter((f) => f.zoho));
  const zohoFilled = zohoFields.filter((f) => fieldHasValue(f, record)).length;
  const webFields = sections.flatMap((s) => s.fields.filter((f) => f.web));
  const webFilled = webFields.filter((f) => fieldHasValue(f, record)).length;
  const zohoPct = zohoFields.length > 0 ? Math.round((zohoFilled / zohoFields.length) * 100) : 0;
  const webPct = webFields.length > 0 ? Math.round((webFilled / webFields.length) * 100) : 0;
  const isApproved = ["aprobado", "listo"].includes(zohoStatus.pipeline);

  return (
    <tr>
      <td colSpan={colSpan} className="px-0 py-0">
        <div className="border-t-2 border-blue-200 bg-slate-50 px-6 py-5" onClick={(e) => e.stopPropagation()}>
          <FieldGrid sections={sections} record={record} />
          <div className="border-t pt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-lg border bg-white p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-6 h-6 rounded bg-orange-100 text-orange-600 text-xs font-bold flex items-center justify-center">Z</span>
                <span className="text-sm font-semibold">Zoho CRM</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-700">{zohoFilled}/{zohoFields.length} campos</span>
              </div>
              <div className="h-2 bg-gray-200 rounded-full overflow-hidden mb-3">
                <div className={`h-full rounded-full transition-all ${zohoPct >= 75 ? "bg-green-500" : zohoPct >= 50 ? "bg-amber-500" : "bg-red-400"}`} style={{ width: `${zohoPct}%` }} />
              </div>
              <div className="flex items-center gap-2 text-xs mb-1">
                <span className={`inline-block w-2 h-2 rounded-full ${isApproved ? "bg-green-500" : "bg-gray-300"}`} />
                <span className="text-gray-600">
                  {zohoStatus.entityLabel}: <span className={isApproved ? "text-green-600 font-medium" : "text-gray-500"}>{isApproved ? "Aprobado" : "No aprobado"}</span>
                </span>
              </div>
              {zohoStatus.recordId ? (
                <div className="text-xs text-green-600 mt-1">{"\u2713"} Synced {"\u2014"} ID: {zohoStatus.recordId}</div>
              ) : isApproved ? (
                <div className="text-xs text-amber-600 mt-1">Pendiente de sync (siguiente ciclo)</div>
              ) : (
                <div className="text-xs text-gray-500 mt-1">Cambia el pipeline a &quot;Aprobado&quot; para sincronizar</div>
              )}
            </div>
            <div className="rounded-lg border bg-white p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-6 h-6 rounded bg-blue-100 text-blue-600 text-xs font-bold flex items-center justify-center">W</span>
                <span className="text-sm font-semibold">Sitio Web</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">{webFilled}/{webFields.length} campos</span>
              </div>
              <div className="h-2 bg-gray-200 rounded-full overflow-hidden mb-3">
                <div className={`h-full rounded-full transition-all ${webPct >= 75 ? "bg-green-500" : webPct >= 50 ? "bg-amber-500" : "bg-red-400"}`} style={{ width: `${webPct}%` }} />
              </div>
              <div className="text-xs text-gray-500 mt-1">
                Campos listos para publicaci&oacute;n en propyte.com
              </div>
            </div>
          </div>
        </div>
      </td>
    </tr>
  );
}

function UnitDetailPanel({ unit, onToggleWeb }: {
  unit: Unit & { _completeness: CompletenessInfo };
  onToggleWeb: (id: string, value: boolean) => void;
}) {
  const isDevApproved = ["aprobado", "listo"].includes(unit.desarrollo_pipeline_status);
  const rec = unit as unknown as Record<string, unknown>;

  const zohoFields = UNIT_DETAIL_SECTIONS.flatMap((s) => s.fields.filter((f) => f.zoho));
  const zohoFilled = zohoFields.filter((f) => fieldHasValue(f, rec)).length;
  const webFields = UNIT_DETAIL_SECTIONS.flatMap((s) => s.fields.filter((f) => f.web));
  const webFilled = webFields.filter((f) => fieldHasValue(f, rec)).length;
  const zohoPct = Math.round((zohoFilled / zohoFields.length) * 100);
  const webPct = Math.round((webFilled / webFields.length) * 100);

  return (
    <tr>
      <td colSpan={9} className="px-0 py-0">
        <div className="border-t-2 border-blue-200 bg-slate-50 px-6 py-5" onClick={(e) => e.stopPropagation()}>
          <FieldGrid sections={UNIT_DETAIL_SECTIONS} record={rec} />
          <div className="border-t pt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Zoho CRM */}
            <div className="rounded-lg border bg-white p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-6 h-6 rounded bg-orange-100 text-orange-600 text-xs font-bold flex items-center justify-center">Z</span>
                <span className="text-sm font-semibold">Zoho CRM</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-700">{zohoFilled}/{zohoFields.length} campos</span>
              </div>
              <div className="h-2 bg-gray-200 rounded-full overflow-hidden mb-3">
                <div className={`h-full rounded-full transition-all ${zohoPct >= 75 ? "bg-green-500" : zohoPct >= 50 ? "bg-amber-500" : "bg-red-400"}`} style={{ width: `${zohoPct}%` }} />
              </div>
              <div className="flex items-center gap-2 text-xs mb-1">
                <span className={`inline-block w-2 h-2 rounded-full ${isDevApproved ? "bg-green-500" : "bg-gray-300"}`} />
                <span className="text-gray-600">
                  Desarrollo: <span className="font-medium">{unit.desarrollo_nombre}</span>
                  {" \u2014 "}
                  <span className={isDevApproved ? "text-green-600 font-medium" : "text-gray-500"}>
                    {isDevApproved ? "Aprobado" : "No aprobado"}
                  </span>
                </span>
              </div>
              {unit.zoho_record_id ? (
                <div className="text-xs text-green-600 mt-1">{"\u2713"} Synced {"\u2014"} ID: {unit.zoho_record_id}</div>
              ) : isDevApproved ? (
                <div className="text-xs text-amber-600 mt-1">Pendiente de sync (siguiente ciclo)</div>
              ) : (
                <div className="text-xs text-gray-500 mt-1">Para sincronizar, aprueba el desarrollo padre</div>
              )}
            </div>

            {/* Sitio Web */}
            <div className="rounded-lg border bg-white p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-6 h-6 rounded bg-blue-100 text-blue-600 text-xs font-bold flex items-center justify-center">W</span>
                <span className="text-sm font-semibold">Sitio Web</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">{webFilled}/{webFields.length} campos</span>
              </div>
              <div className="h-2 bg-gray-200 rounded-full overflow-hidden mb-3">
                <div className={`h-full rounded-full transition-all ${webPct >= 75 ? "bg-green-500" : webPct >= 50 ? "bg-amber-500" : "bg-red-400"}`} style={{ width: `${webPct}%` }} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-600">Publicar en sitio web:</span>
                <button
                  onClick={() => onToggleWeb(unit.id, !unit.ext_publicado)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    unit.ext_publicado ? "bg-blue-600" : "bg-gray-300"
                  }`}
                >
                  <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                    unit.ext_publicado ? "translate-x-6" : "translate-x-1"
                  }`} />
                </button>
              </div>
              <div className={`text-xs mt-2 ${unit.ext_publicado ? "text-blue-600 font-medium" : "text-gray-500"}`}>
                {unit.ext_publicado ? "\u2713 Publicado en web" : "No publicado"}
              </div>
            </div>
          </div>
        </div>
      </td>
    </tr>
  );
}

function ZohoDot({ synced, approved }: { synced: boolean; approved: boolean }) {
  if (synced) return <span className="inline-block w-2 h-2 rounded-full bg-green-500" title="Synced a Zoho" />;
  if (approved) return <span className="inline-block w-2 h-2 rounded-full bg-amber-400" title="Pendiente de sync" />;
  return <span className="inline-block w-2 h-2 rounded-full bg-gray-300" title="No aprobado" />;
}
