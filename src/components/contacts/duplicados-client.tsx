"use client";

import { useCallback, useEffect, useState } from "react";

interface Ct {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string;
  createdAt: string;
  assignedTo: { name: string | null } | null;
  _count: { deals: number; activities: number };
}

export function DuplicadosClient() {
  const [groups, setGroups] = useState<Ct[][]>([]);
  const [loading, setLoading] = useState(true);
  const [survivors, setSurvivors] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/contacts/duplicates");
    const json = await res.json();
    const data: Ct[][] = json.data ?? [];
    const def: Record<number, string> = {};
    data.forEach((g, idx) => {
      const best = [...g].sort(
        (a, b) =>
          b._count.deals +
          b._count.activities -
          (a._count.deals + a._count.activities) ||
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      )[0];
      def[idx] = best.id;
    });
    setGroups(data);
    setSurvivors(def);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function mergeGroup(idx: number, group: Ct[]) {
    const survivorId = survivors[idx];
    if (!survivorId) return;
    const losers = group.filter((c) => c.id !== survivorId);
    if (
      !window.confirm(
        `¿Fusionar ${losers.length} contacto(s) en el seleccionado? Es reversible (soft-delete).`
      )
    )
      return;
    setBusy(true);
    for (const l of losers) {
      const res = await fetch("/api/contacts/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ survivorId, loserId: l.id }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(j.error ?? "Error al fusionar");
        break;
      }
    }
    setBusy(false);
    await load();
  }

  return (
    <div className="space-y-5 p-6">
      <div>
        <h1 className="text-xl font-semibold text-[color:var(--text-primary)]">
          Contactos duplicados
        </h1>
        <p className="text-[13px] text-[color:var(--text-tertiary)]">
          Agrupados por email o teléfono. Elige el sobreviviente y fusiona.
        </p>
      </div>

      {loading ? (
        <p className="text-[13px] text-[color:var(--text-tertiary)]">Cargando…</p>
      ) : groups.length === 0 ? (
        <p className="text-[13px] text-[color:var(--text-tertiary)]">
          No se detectaron duplicados.
        </p>
      ) : (
        <div className="space-y-4">
          {groups.map((g, idx) => (
            <div
              key={idx}
              className="crm-card rounded-lg border p-4"
              style={{
                borderColor: "var(--border-default)",
                background: "var(--bg-card)",
              }}
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[13px] font-semibold text-[color:var(--text-secondary)]">
                  {g.length} posibles duplicados
                </span>
                <button
                  className="btn-primary text-xs disabled:opacity-40"
                  disabled={busy}
                  onClick={() => mergeGroup(idx, g)}
                >
                  Fusionar en el seleccionado
                </button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {g.map((c) => (
                  <label
                    key={c.id}
                    className="flex cursor-pointer items-start gap-2 rounded border p-2 text-[13px]"
                    style={{ borderColor: "var(--border-subtle)" }}
                  >
                    <input
                      type="radio"
                      name={`surv-${idx}`}
                      checked={survivors[idx] === c.id}
                      onChange={() =>
                        setSurvivors((s) => ({ ...s, [idx]: c.id }))
                      }
                      className="mt-1"
                    />
                    <span>
                      <span className="font-medium text-[color:var(--text-primary)]">
                        {c.firstName} {c.lastName}
                      </span>
                      <span className="block text-[color:var(--text-tertiary)]">
                        {c.email ?? "sin email"} · {c.phone}
                      </span>
                      <span className="block text-[color:var(--text-tertiary)]">
                        {c._count.deals} deals · {c._count.activities} act. ·{" "}
                        {c.assignedTo?.name ?? "sin asesor"}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
