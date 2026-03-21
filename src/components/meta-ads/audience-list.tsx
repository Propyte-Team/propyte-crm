// Audience list — Design System v2
"use client"

import { useState, useEffect } from "react"
import { Loader2, Users } from "lucide-react"

interface Audience {
  id: string
  name: string
  subtype: string
  approximate_count_lower_bound?: number
  approximate_count_upper_bound?: number
  description?: string
}

interface AudienceListProps {
  accountId: string
}

function formatCount(lower?: number, upper?: number): string {
  if (!lower && !upper) return "—"
  const avg = upper && lower ? Math.round((lower + upper) / 2) : lower || upper || 0
  if (avg >= 1_000_000) return `~${(avg / 1_000_000).toFixed(1)}M`
  if (avg >= 1_000) return `~${(avg / 1_000).toFixed(0)}K`
  return `~${avg}`
}

const subtypeLabels: Record<string, string> = {
  CUSTOM: "Custom",
  WEBSITE: "Website",
  LOOKALIKE: "Lookalike",
  ENGAGEMENT: "Engagement",
  DATA_SET: "Data Set",
  OFFLINE_CONVERSION: "Conversiones",
  STORE_VISIT: "Visitas tienda",
  BAG_OF_ACCOUNTS: "Cuentas",
  IG_BUSINESS: "Instagram",
  FB_EVENT: "Evento FB",
}

export function AudienceList({ accountId }: AudienceListProps) {
  const [audiences, setAudiences] = useState<Audience[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchAudiences() {
      setLoading(true)
      try {
        const res = await fetch(`/api/meta-ads/audiences?account_id=${accountId}`)
        const json = await res.json()
        setAudiences(json.data || [])
      } catch {
        setAudiences([])
      } finally {
        setLoading(false)
      }
    }
    fetchAudiences()
  }, [accountId])

  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin" style={{ color: "var(--color-teal)" }} />
      </div>
    )
  }

  return (
    <div className="crm-card overflow-hidden p-0">
      <div className="px-5 py-4">
        <h3 className="text-[15px] font-semibold" style={{ color: "var(--text-primary)" }}>
          Audiencias ({audiences.length})
        </h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr style={{ borderTop: "1px solid var(--border-subtle)" }}>
              <th className="px-4 py-2.5 text-left font-medium" style={{ color: "var(--text-tertiary)", borderBottom: "1px solid var(--border-subtle)" }}>
                Nombre
              </th>
              <th className="px-4 py-2.5 text-left font-medium" style={{ color: "var(--text-tertiary)", borderBottom: "1px solid var(--border-subtle)" }}>
                Tipo
              </th>
              <th className="px-4 py-2.5 text-right font-medium" style={{ color: "var(--text-tertiary)", borderBottom: "1px solid var(--border-subtle)" }}>
                Tamano aprox.
              </th>
            </tr>
          </thead>
          <tbody>
            {audiences.length === 0 && (
              <tr>
                <td colSpan={3} className="py-12 text-center" style={{ color: "var(--text-tertiary)" }}>
                  <Users className="mx-auto mb-2 h-8 w-8 opacity-40" />
                  Sin audiencias personalizadas
                </td>
              </tr>
            )}
            {audiences.map((a) => (
              <tr
                key={a.id}
                style={{ borderBottom: "1px solid var(--border-subtle)" }}
              >
                <td className="max-w-[300px] truncate px-4 py-2.5 font-medium" style={{ color: "var(--text-primary)" }}>
                  {a.name}
                </td>
                <td className="px-4 py-2.5">
                  <span
                    className="inline-block rounded-full px-2 py-0.5 text-[11px] font-medium"
                    style={{ background: "var(--color-teal-light)", color: "var(--color-teal)" }}
                  >
                    {subtypeLabels[a.subtype] || a.subtype}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right" style={{ color: "var(--text-secondary)" }}>
                  {formatCount(a.approximate_count_lower_bound, a.approximate_count_upper_bound)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
