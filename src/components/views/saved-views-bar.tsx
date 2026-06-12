// Barra de vistas guardadas (Fase 5, T5.4). Genérica por módulo: guarda y aplica
// el conjunto de filtros actual. Resiliente si la API/tabla aún no está.
"use client";

import { useState, useEffect, useCallback } from "react";
import { Bookmark, Plus, X } from "lucide-react";

interface SavedView { id: string; name: string; filters: Record<string, unknown>; scope: string }

interface Props {
  module: string;
  currentFilters: Record<string, unknown>;
  onApply: (filters: Record<string, unknown>) => void;
}

export function SavedViewsBar({ module, currentFilters, onApply }: Props) {
  const [views, setViews] = useState<SavedView[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/saved-views?module=${module}`);
    if (res.ok) setViews((await res.json()).data ?? []);
  }, [module]);
  useEffect(() => { load(); }, [load]);

  async function saveCurrent() {
    const name = window.prompt("Nombre de la vista:");
    if (!name) return;
    const res = await fetch("/api/saved-views", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, module, filters: currentFilters, scope: "personal" }),
    });
    if (res.ok) load();
    else window.alert("No se pudo guardar la vista (puede faltar la migración).");
  }

  async function remove(id: string) {
    await fetch(`/api/saved-views?id=${id}`, { method: "DELETE" });
    if (activeId === id) setActiveId(null);
    load();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Bookmark className="h-3.5 w-3.5" style={{ color: "var(--text-tertiary, #888)" }} />
      {views.map((v) => (
        <span
          key={v.id}
          className="group inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs"
          style={{
            borderColor: activeId === v.id ? "var(--color-teal, #0D9488)" : "var(--border-default, #e5e5e5)",
            background: activeId === v.id ? "var(--color-teal, #0D9488)" : "transparent",
            color: activeId === v.id ? "#fff" : "var(--text-secondary, #555)",
          }}
        >
          <button onClick={() => { setActiveId(v.id); onApply(v.filters ?? {}); }}>{v.name}</button>
          <button onClick={() => remove(v.id)} className="opacity-0 transition-opacity group-hover:opacity-60" title="Eliminar vista">
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <button onClick={saveCurrent} className="inline-flex items-center gap-1 rounded-full border border-dashed px-2.5 py-1 text-xs" style={{ borderColor: "var(--border-default, #e5e5e5)", color: "var(--text-tertiary, #888)" }}>
        <Plus className="h-3 w-3" /> Guardar vista
      </button>
    </div>
  );
}
