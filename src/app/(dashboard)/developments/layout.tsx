"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";

const baseTabs = [{ label: "Desarrollos", href: "/developments" }];
const adminTabs = [{ label: "Captura", href: "/developments/captura" }];

export default function DevelopmentsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const role = (session?.user as { role?: string })?.role;
  const tabs = ["DIRECTOR", "GERENTE", "ADMIN"].includes(role ?? "")
    ? [...baseTabs, ...adminTabs]
    : baseTabs;

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
