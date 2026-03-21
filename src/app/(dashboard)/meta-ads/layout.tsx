// Layout para Meta Ads — tabs de navegación
"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Megaphone } from "lucide-react"

const tabs = [
  { label: "Vista General", href: "/meta-ads" },
  { label: "Campanas", href: "/meta-ads/campaigns" },
  { label: "Anuncios", href: "/meta-ads/ads" },
  { label: "Audiencias", href: "/meta-ads/audiences" },
]

export default function MetaAdsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  function isActive(href: string) {
    if (href === "/meta-ads") return pathname === "/meta-ads"
    return pathname?.startsWith(href)
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div
          className="flex h-9 w-9 items-center justify-center rounded-lg"
          style={{ background: "rgba(96, 165, 250, 0.12)" }}
        >
          <Megaphone className="h-[18px] w-[18px]" style={{ color: "#60A5FA" }} />
        </div>
        <div>
          <h1 className="text-xl font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>
            Meta Ads
          </h1>
          <p className="text-[13px]" style={{ color: "var(--text-secondary)" }}>
            Campanas de Facebook e Instagram
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

      {/* Content */}
      {children}
    </div>
  )
}
