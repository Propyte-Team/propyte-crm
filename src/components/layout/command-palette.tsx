// Command palette global (Fase 5): ⌘K / Ctrl+K. Búsqueda global (contactos + deals)
// vía /api/records/search + navegación rápida. Minimalista.
"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Search, User, Kanban, Sun, Users, DollarSign, FileText, Building2, Settings } from "lucide-react";

interface Hit { id: string; name: string; meta?: string; kind: "contact" | "deal" }

const NAV = [
  { label: "Hoy", href: "/hoy", icon: Sun },
  { label: "Pipeline", href: "/pipeline", icon: Kanban },
  { label: "Contactos", href: "/contacts", icon: Users },
  { label: "Cotizaciones", href: "/cotizaciones", icon: FileText },
  { label: "Cobranza", href: "/cobranza", icon: DollarSign },
  { label: "Desarrollos", href: "/developments", icon: Building2 },
  { label: "Configuración", href: "/configuracion", icon: Settings },
];

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Atajo de teclado global
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 30);
    else { setQ(""); setHits([]); setActive(0); }
  }, [open]);

  // Búsqueda con debounce (contactos + deals en paralelo)
  useEffect(() => {
    if (debRef.current) clearTimeout(debRef.current);
    if (q.trim().length < 2) { setHits([]); return; }
    debRef.current = setTimeout(async () => {
      try {
        const [c, d] = await Promise.all([
          fetch(`/api/records/search?object=contact&q=${encodeURIComponent(q)}`).then((r) => (r.ok ? r.json() : { data: [] })),
          fetch(`/api/records/search?object=deal&q=${encodeURIComponent(q)}`).then((r) => (r.ok ? r.json() : { data: [] })),
        ]);
        const merged: Hit[] = [
          ...(c.data ?? []).map((h: any) => ({ ...h, kind: "contact" as const })),
          ...(d.data ?? []).map((h: any) => ({ ...h, kind: "deal" as const })),
        ];
        setHits(merged);
        setActive(0);
      } catch { setHits([]); }
    }, 250);
  }, [q]);

  const go = useCallback((href: string) => { setOpen(false); router.push(href); }, [router]);

  const navFiltered = q.trim()
    ? NAV.filter((n) => n.label.toLowerCase().includes(q.toLowerCase()))
    : NAV;
  const hitHref = (h: Hit) => (h.kind === "contact" ? `/contacts/${h.id}` : `/pipeline?dealId=${h.id}`);
  const flat: Array<{ href: string; render: React.ReactNode }> = [
    ...hits.map((h) => ({
      href: hitHref(h),
      render: (
        <span className="flex items-center gap-3">
          {h.kind === "contact" ? <User className="h-4 w-4 text-[color:var(--text-tertiary)]" /> : <Kanban className="h-4 w-4 text-[color:var(--text-tertiary)]" />}
          <span className="flex-1">{h.name}</span>
          <span className="text-[11px] text-[color:var(--text-tertiary)]">{h.meta ?? (h.kind === "contact" ? "Contacto" : "Deal")}</span>
        </span>
      ),
    })),
    ...navFiltered.map((n) => {
      const Icon = n.icon;
      return {
        href: n.href,
        render: (
          <span className="flex items-center gap-3">
            <Icon className="h-4 w-4 text-[color:var(--text-tertiary)]" />
            <span className="flex-1">Ir a {n.label}</span>
          </span>
        ),
      };
    }),
  ];

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center p-4 pt-[12vh]" style={{ background: "rgba(0,0,0,.4)" }} onClick={() => setOpen(false)}>
      <div className="w-full max-w-xl overflow-hidden rounded-xl border shadow-2xl" style={{ background: "var(--bg-card)", borderColor: "var(--border-default)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b px-4 py-3" style={{ borderColor: "var(--border-subtle)" }}>
          <Search className="h-4 w-4 text-[color:var(--text-tertiary)]" />
          <input
            ref={inputRef}
            className="flex-1 bg-transparent text-[14px] outline-none"
            placeholder="Buscar contactos, deals, o ir a…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, flat.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
              if (e.key === "Enter" && flat[active]) { e.preventDefault(); go(flat[active].href); }
            }}
          />
          <kbd className="rounded border px-1.5 py-0.5 text-[10px] text-[color:var(--text-tertiary)]" style={{ borderColor: "var(--border-default)" }}>esc</kbd>
        </div>
        <ul className="max-h-[50vh] overflow-y-auto py-1">
          {flat.length === 0 ? (
            <li className="px-4 py-6 text-center text-[13px] text-[color:var(--text-tertiary)]">
              {q.trim().length >= 2 ? "Sin resultados." : "Escribe para buscar…"}
            </li>
          ) : (
            flat.map((item, i) => (
              <li key={i}>
                <button
                  className="flex w-full items-center px-4 py-2 text-left text-[13px]"
                  style={{ background: i === active ? "var(--bg-row-hover)" : "transparent", color: "var(--text-primary)" }}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(item.href)}
                >
                  {item.render}
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
