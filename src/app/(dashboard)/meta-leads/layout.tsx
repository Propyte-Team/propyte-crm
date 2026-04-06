// Layout para Meta Leads — tabs de navegacion
"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { DatabaseZap } from "lucide-react"

const tabs = [
  { label: "Overview", href: "/meta-leads" },
  { label: "Discrepancias", href: "/meta-leads/discrepancies" },
]

export default function MetaLeadsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  function isActive(href: string) {
    if (href === "/meta-leads") return pathname === "/meta-leads"
    return pathname?.startsWith(href)
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div
          className="flex h-9 w-9 items-center justify-center rounded-lg"
          style={{ background: "rgba(251, 146, 60, 0.12)" }}
        >
          <DatabaseZap className="h-[18px] w-[18px]" style={{ color: "#FB923C" }} />
        </div>
        <div>
          <h1 className="text-xl font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>
            Meta Leads
          </h1>
          <p className="text-[13px]" style={{ color: "var(--text-secondary)" }}>
            Backup de formularios Meta vs CRM — deteccion de discrepancias
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
        {tabs.map((tab) => {
          const active = isActive(tab.href)
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className="relative px-4 py-2 text-[13px] font-medium transition-colors"
              style={{
                color: active ? "var(--color-teal)" : "var(--text-tertiary)",
              }}
              onMouseEnter={(e) => {
                if (!active) e.currentTarget.style.color = "var(--text-primary)"
              }}
              onMouseLeave={(e) => {
                if (!active) e.currentTarget.style.color = "var(--text-tertiary)"
              }}
            >
              {tab.label}
              {active && (
                <div
                  className="absolute bottom-0 left-0 right-0 h-[2px]"
                  style={{ background: "var(--color-teal)" }}
                />
              )}
            </Link>
          )
        })}
      </div>

      {children}
    </div>
  )
}
