"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useState } from "react"
import {
  AlertTriangle,
  Download,
  RefreshCcw,
  Search,
  ChevronLeft,
  ChevronRight,
} from "lucide-react"
import type { MetaLeadRow } from "@/server/meta-leads"

interface Props {
  leads: MetaLeadRow[]
  totalCount: number
  pageCount: number
  currentPage: number
  campaigns: string[]
  filters: { campaign?: string; search?: string; dateFrom?: string; dateTo?: string }
}

export function DiscrepanciesContent({
  leads,
  totalCount,
  pageCount,
  currentPage,
  campaigns,
  filters,
}: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
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
    router.push(`/meta-leads/discrepancies?${params.toString()}`)
  }

  function goToPage(page: number) {
    const params = new URLSearchParams(searchParams.toString())
    params.set("page", String(page))
    router.push(`/meta-leads/discrepancies?${params.toString()}`)
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

  return (
    <div className="space-y-5">
      {/* Alert banner */}
      {totalCount > 0 && (
        <div
          className="flex items-center gap-3 rounded-lg border p-4"
          style={{ borderColor: "#EF4444", background: "rgba(239,68,68,0.06)" }}
        >
          <AlertTriangle className="h-5 w-5 shrink-0" style={{ color: "#EF4444" }} />
          <div className="flex-1">
            <p className="text-[13px] font-medium" style={{ color: "#EF4444" }}>
              {totalCount} leads de Meta no estan en el CRM
            </p>
            <p className="text-[12px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>
              Estos leads llenaron formulario en Meta pero no fueron subidos a Zoho.
              Exporta el CSV y subilos via LeadChain.
            </p>
          </div>
          <a
            href="/api/meta-leads/export"
            className="flex items-center gap-1.5 h-9 rounded-md px-4 text-[13px] font-medium text-white shrink-0"
            style={{ background: "#EF4444" }}
          >
            <Download className="h-3.5 w-3.5" />
            Exportar CSV
          </a>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
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

        {/* Date filters */}
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={filters.dateFrom || ""}
            onChange={(e) => updateFilter("dateFrom", e.target.value || undefined)}
            className="h-9 rounded-md border px-2 text-[13px]"
            style={{
              background: "var(--bg-secondary)",
              borderColor: "var(--border-subtle)",
              color: "var(--text-primary)",
            }}
          />
          <span className="text-[12px]" style={{ color: "var(--text-tertiary)" }}>a</span>
          <input
            type="date"
            value={filters.dateTo || ""}
            onChange={(e) => updateFilter("dateTo", e.target.value || undefined)}
            className="h-9 rounded-md border px-2 text-[13px]"
            style={{
              background: "var(--bg-secondary)",
              borderColor: "var(--border-subtle)",
              color: "var(--text-primary)",
            }}
          />
        </div>

        <button
          onClick={handleRecompare}
          disabled={recomparing}
          className="flex items-center gap-1.5 h-9 rounded-md border px-3 text-[13px] font-medium ml-auto"
          style={{
            borderColor: "var(--border-subtle)",
            color: "var(--text-secondary)",
            background: "var(--bg-secondary)",
          }}
        >
          <RefreshCcw className={`h-3.5 w-3.5 ${recomparing ? "animate-spin" : ""}`} />
          {recomparing ? "Comparando..." : "Re-comparar con CRM"}
        </button>
      </div>

      {/* Table */}
      <div className="rounded-lg border overflow-auto" style={{ borderColor: "var(--border-subtle)" }}>
        <table className="w-full text-[13px]">
          <thead>
            <tr style={{ background: "var(--bg-secondary)" }}>
              <th className="px-3 py-2.5 text-left font-medium" style={{ color: "var(--text-secondary)" }}>Fecha</th>
              <th className="px-3 py-2.5 text-left font-medium" style={{ color: "var(--text-secondary)" }}>Nombre</th>
              <th className="px-3 py-2.5 text-left font-medium" style={{ color: "var(--text-secondary)" }}>Email</th>
              <th className="px-3 py-2.5 text-left font-medium" style={{ color: "var(--text-secondary)" }}>Telefono</th>
              <th className="px-3 py-2.5 text-left font-medium" style={{ color: "var(--text-secondary)" }}>Pais</th>
              <th className="px-3 py-2.5 text-left font-medium" style={{ color: "var(--text-secondary)" }}>Campana</th>
              <th className="px-3 py-2.5 text-left font-medium" style={{ color: "var(--text-secondary)" }}>Ad Set</th>
              <th className="px-3 py-2.5 text-left font-medium" style={{ color: "var(--text-secondary)" }}>Anuncio</th>
              <th className="px-3 py-2.5 text-left font-medium" style={{ color: "var(--text-secondary)" }}>Formulario</th>
            </tr>
          </thead>
          <tbody>
            {leads.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center" style={{ color: "var(--text-tertiary)" }}>
                  No hay discrepancias — todos los leads de Meta estan en el CRM
                </td>
              </tr>
            )}
            {leads.map((lead) => {
              const date = new Date(lead.createdOnMeta)
              return (
                <tr
                  key={lead.id}
                  className="border-t transition-colors"
                  style={{ borderColor: "var(--border-subtle)" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(239,68,68,0.03)" }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent" }}
                >
                  <td className="px-3 py-2 whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>
                    {date.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" })}
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
                  <td className="px-3 py-2" style={{ color: "var(--text-tertiary)" }}>
                    {lead.country || "—"}
                  </td>
                  <td className="px-3 py-2 max-w-[160px] truncate" style={{ color: "var(--text-secondary)" }} title={lead.campaignName || ""}>
                    {lead.campaignName || "—"}
                  </td>
                  <td className="px-3 py-2 max-w-[140px] truncate" style={{ color: "var(--text-tertiary)" }} title={lead.adsetName || ""}>
                    {lead.adsetName || "—"}
                  </td>
                  <td className="px-3 py-2 max-w-[140px] truncate" style={{ color: "var(--text-tertiary)" }} title={lead.adName || ""}>
                    {lead.adName || "—"}
                  </td>
                  <td className="px-3 py-2 max-w-[120px] truncate" style={{ color: "var(--text-tertiary)" }} title={lead.formName || ""}>
                    {lead.formName || "—"}
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
            {totalCount} leads faltantes — Pagina {currentPage} de {pageCount}
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
    </div>
  )
}
