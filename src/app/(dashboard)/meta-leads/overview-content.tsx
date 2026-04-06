"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useState } from "react"
import {
  CheckCircle2,
  AlertTriangle,
  Clock,
  Copy,
  Download,
  RefreshCcw,
  Search,
  ChevronLeft,
  ChevronRight,
} from "lucide-react"
import type { MetaLeadStats, MetaLeadRow } from "@/server/meta-leads"

// ============================================================
// Types
// ============================================================

interface Props {
  stats: MetaLeadStats
  leads: MetaLeadRow[]
  totalCount: number
  pageCount: number
  currentPage: number
  campaigns: string[]
  filters: {
    status?: string
    campaign?: string
    search?: string
  }
}

// ============================================================
// Status helpers
// ============================================================

const STATUS_CONFIG = {
  MATCHED: { label: "En CRM", color: "#22C55E", bg: "rgba(34,197,94,0.1)" },
  MISSING_IN_CRM: { label: "Falta en CRM", color: "#EF4444", bg: "rgba(239,68,68,0.1)" },
  PENDING: { label: "Pendiente", color: "#F59E0B", bg: "rgba(245,158,11,0.1)" },
  DUPLICATE: { label: "Duplicado", color: "#8B5CF6", bg: "rgba(139,92,246,0.1)" },
} as const

// ============================================================
// Component
// ============================================================

export function MetaLeadsOverview({
  stats,
  leads,
  totalCount,
  pageCount,
  currentPage,
  campaigns,
  filters,
}: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [syncing, setSyncing] = useState(false)
  const [recomparing, setRecomparing] = useState(false)
  const [searchInput, setSearchInput] = useState(filters.search || "")

  function updateFilter(key: string, value: string | undefined) {
    const params = new URLSearchParams(searchParams.toString())
    if (value) {
      params.set(key, value)
    } else {
      params.delete(key)
    }
    params.delete("page")
    router.push(`/meta-leads?${params.toString()}`)
  }

  function goToPage(page: number) {
    const params = new URLSearchParams(searchParams.toString())
    params.set("page", String(page))
    router.push(`/meta-leads?${params.toString()}`)
  }

  async function handleSync() {
    setSyncing(true)
    try {
      await fetch("/api/meta-leads/sync", { method: "POST" })
      router.refresh()
    } finally {
      setSyncing(false)
    }
  }

  async function handleRecompare() {
    setRecomparing(true)
    try {
      await fetch("/api/meta-leads/recompare", { method: "POST" })
      router.refresh()
    } finally {
      setRecomparing(false)
    }
  }

  const matchRate = stats.total > 0 ? Math.round((stats.matched / stats.total) * 100) : 0

  return (
    <div className="space-y-5">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard label="Total Meta" value={stats.total} icon={<Copy className="h-4 w-4" />} color="#60A5FA" />
        <KpiCard label="En CRM" value={stats.matched} icon={<CheckCircle2 className="h-4 w-4" />} color="#22C55E" subtitle={`${matchRate}% match`} />
        <KpiCard label="Faltan en CRM" value={stats.missingInCrm} icon={<AlertTriangle className="h-4 w-4" />} color="#EF4444" highlight={stats.missingInCrm > 0} />
        <KpiCard label="Pendientes" value={stats.pending} icon={<Clock className="h-4 w-4" />} color="#F59E0B" />
        <KpiCard label="Duplicados" value={stats.duplicate} icon={<Copy className="h-4 w-4" />} color="#8B5CF6" />
      </div>

      {/* Actions bar */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: "var(--text-tertiary)" }} />
          <input
            type="text"
            placeholder="Buscar por nombre, email, telefono..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") updateFilter("search", searchInput || undefined)
            }}
            className="h-9 w-full rounded-md border pl-9 pr-3 text-[13px] outline-none"
            style={{
              background: "var(--bg-secondary)",
              borderColor: "var(--border-subtle)",
              color: "var(--text-primary)",
            }}
          />
        </div>

        {/* Status filter */}
        <select
          value={filters.status || ""}
          onChange={(e) => updateFilter("status", e.target.value || undefined)}
          className="h-9 rounded-md border px-3 text-[13px]"
          style={{
            background: "var(--bg-secondary)",
            borderColor: "var(--border-subtle)",
            color: "var(--text-primary)",
          }}
        >
          <option value="">Todos los status</option>
          <option value="MATCHED">En CRM</option>
          <option value="MISSING_IN_CRM">Falta en CRM</option>
          <option value="PENDING">Pendiente</option>
          <option value="DUPLICATE">Duplicado</option>
        </select>

        {/* Campaign filter */}
        <select
          value={filters.campaign || ""}
          onChange={(e) => updateFilter("campaign", e.target.value || undefined)}
          className="h-9 rounded-md border px-3 text-[13px] max-w-[250px]"
          style={{
            background: "var(--bg-secondary)",
            borderColor: "var(--border-subtle)",
            color: "var(--text-primary)",
          }}
        >
          <option value="">Todas las campanas</option>
          {campaigns.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>

        {/* Action buttons */}
        <div className="flex gap-2 ml-auto">
          <button
            onClick={handleRecompare}
            disabled={recomparing}
            className="flex items-center gap-1.5 h-9 rounded-md border px-3 text-[13px] font-medium transition-colors"
            style={{
              borderColor: "var(--border-subtle)",
              color: "var(--text-secondary)",
              background: "var(--bg-secondary)",
            }}
          >
            <RefreshCcw className={`h-3.5 w-3.5 ${recomparing ? "animate-spin" : ""}`} />
            Re-comparar
          </button>

          <a
            href="/api/meta-leads/export"
            className="flex items-center gap-1.5 h-9 rounded-md px-3 text-[13px] font-medium text-white"
            style={{ background: "#EF4444" }}
          >
            <Download className="h-3.5 w-3.5" />
            Exportar faltantes ({stats.missingInCrm})
          </a>

          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-1.5 h-9 rounded-md px-3 text-[13px] font-medium text-white"
            style={{ background: "var(--color-teal)" }}
          >
            <RefreshCcw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Sincronizando..." : "Sync Meta"}
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-lg border overflow-auto" style={{ borderColor: "var(--border-subtle)" }}>
        <table className="w-full text-[13px]">
          <thead>
            <tr style={{ background: "var(--bg-secondary)" }}>
              <th className="px-3 py-2.5 text-left font-medium" style={{ color: "var(--text-secondary)" }}>Status</th>
              <th className="px-3 py-2.5 text-left font-medium" style={{ color: "var(--text-secondary)" }}>Fecha</th>
              <th className="px-3 py-2.5 text-left font-medium" style={{ color: "var(--text-secondary)" }}>Nombre</th>
              <th className="px-3 py-2.5 text-left font-medium" style={{ color: "var(--text-secondary)" }}>Email</th>
              <th className="px-3 py-2.5 text-left font-medium" style={{ color: "var(--text-secondary)" }}>Telefono</th>
              <th className="px-3 py-2.5 text-left font-medium" style={{ color: "var(--text-secondary)" }}>Campana</th>
              <th className="px-3 py-2.5 text-left font-medium" style={{ color: "var(--text-secondary)" }}>Formulario</th>
              <th className="px-3 py-2.5 text-left font-medium" style={{ color: "var(--text-secondary)" }}>Plataforma</th>
              <th className="px-3 py-2.5 text-left font-medium" style={{ color: "var(--text-secondary)" }}>Match</th>
            </tr>
          </thead>
          <tbody>
            {leads.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center" style={{ color: "var(--text-tertiary)" }}>
                  {stats.total === 0
                    ? 'No hay leads. Usa "Sync Meta" para descargar leads de Meta.'
                    : "No hay leads con estos filtros."}
                </td>
              </tr>
            )}
            {leads.map((lead) => {
              const cfg = STATUS_CONFIG[lead.status]
              const date = new Date(lead.createdOnMeta)
              return (
                <tr
                  key={lead.id}
                  className="border-t transition-colors"
                  style={{ borderColor: "var(--border-subtle)" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-secondary)" }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent" }}
                >
                  <td className="px-3 py-2">
                    <span
                      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
                      style={{ background: cfg.bg, color: cfg.color }}
                    >
                      {cfg.label}
                    </span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>
                    {date.toLocaleDateString("es-MX", { day: "2-digit", month: "short" })}
                    <span className="ml-1 text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                      {date.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-medium" style={{ color: "var(--text-primary)" }}>
                    {[lead.firstName, lead.lastName].filter(Boolean).join(" ") || "—"}
                  </td>
                  <td className="px-3 py-2" style={{ color: "var(--text-secondary)" }}>
                    {lead.email || "—"}
                  </td>
                  <td className="px-3 py-2" style={{ color: "var(--text-secondary)" }}>
                    {lead.phone || "—"}
                  </td>
                  <td className="px-3 py-2 max-w-[180px] truncate" style={{ color: "var(--text-secondary)" }} title={lead.campaignName || ""}>
                    {lead.campaignName || "—"}
                  </td>
                  <td className="px-3 py-2 max-w-[140px] truncate" style={{ color: "var(--text-secondary)" }} title={lead.formName || ""}>
                    {lead.formName || "—"}
                  </td>
                  <td className="px-3 py-2" style={{ color: "var(--text-tertiary)" }}>
                    {lead.platform || "—"}
                  </td>
                  <td className="px-3 py-2" style={{ color: "var(--text-tertiary)" }}>
                    {lead.matchMethod || "—"}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pageCount > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-[13px]" style={{ color: "var(--text-tertiary)" }}>
            {totalCount} leads total — Pagina {currentPage} de {pageCount}
          </span>
          <div className="flex gap-1">
            <button
              onClick={() => goToPage(currentPage - 1)}
              disabled={currentPage <= 1}
              className="flex h-8 w-8 items-center justify-center rounded-md border disabled:opacity-30"
              style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={() => goToPage(currentPage + 1)}
              disabled={currentPage >= pageCount}
              className="flex h-8 w-8 items-center justify-center rounded-md border disabled:opacity-30"
              style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Campaign breakdown */}
      {stats.byCampaign.length > 0 && (
        <div className="rounded-lg border p-4" style={{ borderColor: "var(--border-subtle)" }}>
          <h3 className="text-[13px] font-semibold mb-3" style={{ color: "var(--text-primary)" }}>
            Leads por Campana
          </h3>
          <div className="space-y-2">
            {stats.byCampaign.map((c) => {
              const matchPct = c.total > 0 ? Math.round(((c.total - c.missing) / c.total) * 100) : 100
              return (
                <div key={c.name} className="flex items-center gap-3 text-[13px]">
                  <span className="flex-1 truncate" style={{ color: "var(--text-secondary)" }} title={c.name}>
                    {c.name}
                  </span>
                  <span className="tabular-nums font-medium" style={{ color: "var(--text-primary)" }}>
                    {c.total}
                  </span>
                  {c.missing > 0 && (
                    <span className="tabular-nums text-[12px]" style={{ color: "#EF4444" }}>
                      {c.missing} faltantes
                    </span>
                  )}
                  <div className="w-24 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--bg-secondary)" }}>
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${matchPct}%`,
                        background: matchPct === 100 ? "#22C55E" : matchPct >= 80 ? "#F59E0B" : "#EF4444",
                      }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================
// KPI Card
// ============================================================

function KpiCard({
  label,
  value,
  icon,
  color,
  subtitle,
  highlight,
}: {
  label: string
  value: number
  icon: React.ReactNode
  color: string
  subtitle?: string
  highlight?: boolean
}) {
  return (
    <div
      className="rounded-lg border p-4 transition-colors"
      style={{
        borderColor: highlight ? color : "var(--border-subtle)",
        background: highlight ? `${color}08` : "var(--bg-primary)",
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-[12px] font-medium uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>
          {label}
        </span>
        <div style={{ color }}>{icon}</div>
      </div>
      <div className="text-2xl font-bold tabular-nums" style={{ color: highlight ? color : "var(--text-primary)" }}>
        {value.toLocaleString("es-MX")}
      </div>
      {subtitle && (
        <div className="text-[12px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>
          {subtitle}
        </div>
      )}
    </div>
  )
}
