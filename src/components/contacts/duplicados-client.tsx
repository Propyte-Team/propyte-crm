"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { leerError } from "@/lib/api-errors";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/use-toast";

export interface Ct {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string;
  createdAt: string;
  assignedTo: { name: string | null } | null;
  instagramId: string | null;
  messengerPsid: string | null;
  _count: { deals: number; activities: number };
}

type MatchType = "strong" | "name";

interface DupGroup {
  matchType: MatchType;
  contacts: Ct[];
}

// Sugerido: el contacto con más negocios + actividades; a igualdad, el más antiguo.
export function elegirPrincipal(contacts: Ct[]): Ct {
  return [...contacts].sort(
    (a, b) =>
      b._count.deals + b._count.activities - (a._count.deals + a._count.activities) ||
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  )[0];
}

function channelLabel(c: Ct): string {
  if (c.instagramId) return "IG";
  if (c.messengerPsid) return "Messenger";
  return "—";
}

function MatchBadge({ matchType }: { matchType: MatchType }) {
  return (
    <span
      className="rounded border px-2 py-0.5 text-[11px] font-medium text-[color:var(--text-tertiary)]"
      style={{ borderColor: "var(--border-subtle)" }}
    >
      {matchType === "strong" ? "Coincidencia fuerte (tel/email)" : "Coincidencia débil (nombre)"}
    </span>
  );
}

export function DuplicadosClient() {
  const confirmar = useConfirm();
  const [groups, setGroups] = useState<DupGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [survivors, setSurvivors] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/contacts/duplicates");
    if (!res.ok) {
      toast({ title: "No se pudieron cargar los duplicados", description: await leerError(res), variant: "destructive" });
      setLoading(false);
      return;
    }
    const json = await res.json().catch(() => ({}));
    const data: DupGroup[] = json.data ?? [];
    const def: Record<number, string> = {};
    data.forEach((g, idx) => {
      def[idx] = elegirPrincipal(g.contacts).id;
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
    const ok = await confirmar({
      titulo: `¿Fusionar ${losers.length} ${losers.length === 1 ? "contacto" : "contactos"} en el contacto principal?`,
      descripcion:
        "Los demás contactos se archivan y no se pueden recuperar desde la pantalla. Sus negocios y actividades pasan al contacto principal.",
      confirmar: "Fusionar",
      peligroso: true,
    });
    if (!ok) return;
    setBusy(true);
    for (const l of losers) {
      const res = await fetch("/api/contacts/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ survivorId, loserId: l.id }),
      });
      if (!res.ok) {
        toast({ title: "No se pudo fusionar", description: await leerError(res, "Error al fusionar"), variant: "destructive" });
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
          Agrupados por email/teléfono (fuerte) o por nombre (débil). Elige el contacto principal y fusiona.
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
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-semibold text-[color:var(--text-secondary)]">
                    {g.contacts.length} posibles duplicados
                  </span>
                  <MatchBadge matchType={g.matchType} />
                </div>
                <button
                  className="btn-primary text-xs disabled:opacity-40"
                  disabled={busy}
                  onClick={() => mergeGroup(idx, g.contacts)}
                >
                  Fusionar en el contacto principal
                </button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {g.contacts.map((c) => (
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
                      </span>{" "}
                      {elegirPrincipal(g.contacts).id === c.id && (
                        <span className="mr-1 rounded bg-[color:var(--color-teal,#0D9488)] px-1.5 py-0.5 text-[10px] font-medium text-white">
                          Sugerido
                        </span>
                      )}
                      <span
                        className="rounded border px-1 text-[10px] text-[color:var(--text-tertiary)]"
                        style={{ borderColor: "var(--border-subtle)" }}
                      >
                        {channelLabel(c)}
                      </span>
                      <span className="block text-[color:var(--text-tertiary)]">
                        {c.email ?? "sin email"} · {c.phone}
                      </span>
                      <span className="block text-[color:var(--text-tertiary)]">
                        {c._count.deals} negocios · {c._count.activities} actividades ·{" "}
                        {c.assignedTo?.name ?? "sin asesor"}
                      </span>
                      <Link
                        href={`/contacts/${c.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-0.5 inline-block text-[12px] underline text-[color:var(--text-secondary)]"
                        onClick={(e) => e.stopPropagation()}
                      >
                        Ver ficha
                      </Link>
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
