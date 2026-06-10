"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

// La pestaña "Captura" se retiró: el intake público vive en el Hub (hub.propyte.com/captura)
const baseTabs = [{ label: "Desarrollos", href: "/developments" }];

export default function DevelopmentsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const tabs = baseTabs;

  const isActive = (href: string) =>
    href === "/developments" ? pathname === "/developments" : pathname?.startsWith(href);

  return (
    <div className="space-y-5">
      <div className="flex gap-1" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
        {tabs.map((tab) => {
          const active = isActive(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className="relative px-4 py-2 text-[13px] font-medium transition-colors"
              style={{ color: active ? "var(--color-teal)" : "var(--text-tertiary)" }}
              onMouseEnter={(e) => {
                if (!active) e.currentTarget.style.color = "var(--text-primary)";
              }}
              onMouseLeave={(e) => {
                if (!active) e.currentTarget.style.color = "var(--text-tertiary)";
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
          );
        })}
      </div>
      {children}
    </div>
  );
}
