// Página "Ver todas" las actividades (destino del link del dashboard).
// Lista paginada desde /api/activities (RBAC por rol en el API). Reusa el
// estilo de item de RecentActivities.
"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { ACTIVITY_CONFIG } from "@/components/dashboard/recent-activities";

interface ActivityItem {
  id: string;
  activityType: string;
  subject: string;
  createdAt: string;
  contact: { id: string; firstName: string; lastName: string } | null;
  user: { id: string; name: string } | null;
}

export default function ActivitiesPage() {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/activities?page=${p}&pageSize=50&sortBy=createdAt&sortOrder=desc`);
      if (res.ok) {
        const json = await res.json();
        setItems((prev) => (p === 1 ? json.data : [...prev, ...json.data]));
        setTotalPages(json.pagination?.totalPages ?? 1);
        setPage(p);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(1); }, [load]);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>Actividades</h1>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Historial de interacciones y tareas</p>
      </div>

      <div className="crm-card">
        {items.length === 0 && !loading ? (
          <p className="py-8 text-center text-sm" style={{ color: "var(--text-tertiary)" }}>Sin actividades</p>
        ) : (
          <div className="space-y-3">
            {items.map((a) => {
              const cfg = ACTIVITY_CONFIG[a.activityType] ?? ACTIVITY_CONFIG.NOTE;
              const Icon = cfg.icon;
              const timeAgo = formatDistanceToNow(new Date(a.createdAt), { addSuffix: true, locale: es });
              const row = (
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: cfg.bg }}>
                    <Icon className="h-4 w-4" style={{ color: cfg.color }} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium leading-tight" style={{ color: "var(--text-primary)" }}>{a.subject}</p>
                    <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                      {a.contact ? `${a.contact.firstName} ${a.contact.lastName}` : "—"}
                      {a.user ? ` · ${a.user.name}` : ""}
                    </p>
                    <p className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>{timeAgo}</p>
                  </div>
                </div>
              );
              return (
                <div key={a.id}>
                  {a.contact ? (
                    <Link href={`/contacts/${a.contact.id}`} className="block rounded-lg p-1 -m-1 transition-colors hover:bg-[var(--bg-hover,rgba(0,0,0,0.03))]">
                      {row}
                    </Link>
                  ) : (
                    row
                  )}
                </div>
              );
            })}
          </div>
        )}

        {page < totalPages && (
          <div className="mt-4 pt-3 text-center" style={{ borderTop: "1px solid var(--border-subtle)" }}>
            <button
              onClick={() => load(page + 1)}
              disabled={loading}
              className="text-[13px] font-medium disabled:opacity-50"
              style={{ color: "var(--color-teal)" }}
            >
              {loading ? "Cargando…" : "Cargar más"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
