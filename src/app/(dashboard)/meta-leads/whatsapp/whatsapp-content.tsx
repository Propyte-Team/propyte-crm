"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useState } from "react"
import {
  MessageCircle,
  Search,
  ChevronLeft,
  ChevronRight,
} from "lucide-react"
import type { MetaLeadRow } from "@/server/meta-leads"

const STATUS_CONFIG = {
  MATCHED: { label: "En CRM", color: "#22C55E", bg: "rgba(34,197,94,0.1)" },
  MISSING_IN_CRM: { label: "Falta en CRM", color: "#EF4444", bg: "rgba(239,68,68,0.1)" },
  PENDING: { label: "Pendiente", color: "#F59E0B", bg: "rgba(245,158,11,0.1)" },
  DUPLICATE: { label: "Duplicado", color: "#8B5CF6", bg: "rgba(139,92,246,0.1)" },
} as const

interface Props {
  leads: MetaLeadRow[]
  totalCount: number
  pageCount: number
  currentPage: number
  campaigns: string[]
  filters: {
    status?: string
    campaign?: string
    search?: string
    dateFrom?: string
    dateTo?: string
  }
}

export function WhatsAppContent({
  leads,
  totalCount,
  pageCount,
  currentPage,
  campaigns,
  filters,
}: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [searchInput, setSearchInput] = useState(filters.search || "")

  function updateFilter(key: string, value: string | undefined) {
    const params = new URLSearchParams(searchParams.toString())
    if (value) {
      params.set(key, value)
    } else {
      params.delete(key)
    }
    params.delete("page")
    router.push(`/meta-leads/whatsapp?${params.toString()}`)
  }

  function goToPage(page: number) {
    const params = new URLSearchParams(searchParams.toString())
    params.set("page", String(page))
    router.push(`/meta-leads/whatsapp?${params.toString()}`)
  }

  return (
    <div className="space-y-5">
      {/* Info banner */}
      <div
        className="flex items-center gap-3 rounded-lg border p-4"
        style={{ borderColor: "#22C55E", background: "rgba(34,197,94,0.06)" }}
      >
        <MessageCircle className="h-5 w-5 shrink-0" style={{ color: "#22C55E" }} />
        <div>
          <p className="text-[13px] font-medium" style={{ color: "#22C55E" }}>
            {totalCount} leads de campanas WhatsApp
          </p>
          <p className="text-[12px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>
            Leads de campanas con destino WhatsApp (WSP). Usa esta vista para revisar con herramientas externas.
          </p>
        </div>
      </div>

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
        {campaigns.length > 1 && (
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
            <option value="">Todas las campanas WSP</option>
            {campaigns.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        )}

        {/* Date filters */}
        <div className="flex items-center gap-1.5 ml-auto">
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
              <th className="px-3 py-2.5 text-left font-medium" style={{ color: "var(--text-secondary)" }}>Ad Set</th>
              <th className="px-3 py-2.5 text-left font-medium" style={{ color: "var(--text-secondary)" }}>Anuncio</th>
              <th className="px-3 py-2.5 text-left font-medium" style={{ color: "var(--text-secondary)" }}>Plataforma</th>
            </tr>
          </thead>
          <tbody>
            {leads.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center" style={{ color: "var(--text-tertiary)" }}>
                  No hay leads de campanas WhatsApp con estos filtros.
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
                  <td className="px-3 py-2 max-w-[140px] truncate" style={{ color: "var(--text-tertiary)" }} title={lead.adsetName || ""}>
                    {lead.adsetName || "—"}
                  </td>
                  <td className="px-3 py-2 max-w-[140px] truncate" style={{ color: "var(--text-tertiary)" }} title={lead.adName || ""}>
                    {lead.adName || "—"}
                  </td>
                  <td className="px-3 py-2" style={{ color: "var(--text-tertiary)" }}>
                    {lead.platform || "—"}
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
            {totalCount} leads WhatsApp — Pagina {currentPage} de {pageCount}
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
