"use client";

import { useCallback, useEffect, useState } from "react";
import { pickSnapshotPrice } from "@/lib/shortlists/quote-from-item";

// /api/hub/units returns { data: [...], source: "hub" }
// Each item: { id, unitNumber, unitType, price, moneda, status, ... }
interface HubUnitLite {
  id: string;
  unitNumber: string;
  unitType: string;
  price: number;
  moneda: string;
  status: string;
}

interface ShortlistItemLite {
  id: string;
  hubUnitId: string;
  note: string | null;
  snapshot: {
    // forma optimista (desde /api/hub/units, claves CRM-mapeadas)
    unitNumber?: string | null;
    unitType?: string | null;
    price?: number | null;
    moneda?: string;
    // forma persistida (buildUnitSnapshot, claves del Hub)
    titulo?: string | null;
    numero?: string | null;
    tipo?: string | null;
    precioMxn?: number | null;
    precioUsd?: number | null;
  };
}

interface ShortlistLite {
  id: string;
  token: string;
  title: string;
  status: "DRAFT" | "SENT" | "OPENED";
  openedAt: string | null;
  dealId: string | null;
  items: ShortlistItemLite[];
  _count?: { views: number };
}

function money(n: number | null | undefined, currency = "MXN") {
  if (n == null) return "—";
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(n);
}

function snapshotLabel(s: ShortlistItemLite["snapshot"]): string {
  return s?.titulo ?? s?.unitNumber ?? s?.numero ?? "Unidad";
}

function snapshotType(s: ShortlistItemLite["snapshot"]): string {
  return s?.unitType ?? s?.tipo ?? "";
}

function snapshotPrice(s: ShortlistItemLite["snapshot"]): string {
  const currency = s?.moneda ?? "MXN";
  const persisted = currency === "USD" ? s?.precioUsd : s?.precioMxn;
  const price = s?.price ?? persisted;
  return money(price, currency);
}

export function ShortlistPanel({
  contactId,
  dealId,
}: {
  contactId: string;
  dealId?: string;
}) {
  const [lists, setLists] = useState<ShortlistLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<ShortlistLite | null>(null);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<HubUnitLite[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const qs = new URLSearchParams(dealId ? { dealId } : { contactId });
    const res = await fetch(`/api/shortlists?${qs.toString()}`);
    const json = await res.json();
    setLists(json.data ?? []);
    setLoading(false);
  }, [contactId, dealId]);

  useEffect(() => {
    load();
  }, [load]);

  async function refreshActive(id: string) {
    const qs = new URLSearchParams(dealId ? { dealId } : { contactId });
    const res = await fetch(`/api/shortlists?${qs.toString()}`);
    const json = await res.json();
    const all: ShortlistLite[] = json.data ?? [];
    setLists(all);
    const found = all.find((s) => s.id === id);
    if (found) setActive(found);
  }

  async function createList() {
    const res = await fetch("/api/shortlists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactId, dealId: dealId ?? null }),
    });
    const json = await res.json();
    if (json.data) {
      setActive({ ...json.data, items: json.data.items ?? [], _count: { views: 0 } });
      await load();
    }
  }

  async function searchUnits(q: string) {
    setSearch(q);
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    const res = await fetch(
      `/api/hub/units?search=${encodeURIComponent(q)}&onlyAvailable=true&limit=20`
    );
    const json = await res.json();
    // Route returns { data: [...], source: "hub" }
    setResults(json.data ?? []);
  }

  async function addUnit(u: HubUnitLite) {
    if (!active) return;
    const optimistic: ShortlistItemLite = {
      id: `tmp-${u.id}`,
      hubUnitId: u.id,
      note: null,
      snapshot: {
        unitNumber: u.unitNumber,
        unitType: u.unitType,
        price: u.price,
        moneda: u.moneda,
      },
    };
    setActive({ ...active, items: [...active.items, optimistic] });
    const res = await fetch(`/api/shortlists/${active.id}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hubUnitId: u.id }),
    });
    if (!res.ok) {
      setActive((a) =>
        a ? { ...a, items: a.items.filter((i) => i.id !== optimistic.id) } : a
      );
      return;
    }
    await refreshActive(active.id);
  }

  async function removeUnit(itemId: string) {
    if (!active) return;
    const prev = active.items;
    setActive({ ...active, items: active.items.filter((i) => i.id !== itemId) });
    const res = await fetch(
      `/api/shortlists/${active.id}/items/${itemId}`,
      { method: "DELETE" }
    );
    if (!res.ok) setActive((a) => (a ? { ...a, items: prev } : a));
  }

  async function promover(item: { hubUnitId: string; snapshot: ShortlistItemLite["snapshot"] }) {
    if (!active?.dealId) return;
    const { listPrice, currency } = pickSnapshotPrice(item.snapshot ?? {});
    if (!listPrice) { alert("La unidad no tiene precio en el snapshot; no se puede cotizar."); return; }
    const res = await fetch("/api/quotes", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dealId: active.dealId, hubUnitId: item.hubUnitId, listPrice, currency, scheme: "CONTADO" }),
    });
    if (res.ok) alert("Cotización creada en el negocio vinculado.");
    else { const j = await res.json().catch(() => ({})); alert(j.error ?? "No se pudo crear la cotización."); }
  }

  async function generateLink() {
    if (!active) return;
    await fetch(`/api/shortlists/${active.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "send" }),
    });
    const url = `${window.location.origin}/p/${active.token}`;
    await navigator.clipboard.writeText(url).catch(() => null);
    alert(`Link copiado:\n${url}`);
    await refreshActive(active.id);
  }

  const statusLabel = (s: ShortlistLite["status"]) => {
    if (s === "DRAFT") return "Borrador";
    if (s === "SENT") return "Enviada";
    return "Abierta";
  };

  return (
    <div
      className="rounded-lg border p-4"
      style={{ borderColor: "var(--border-default)", background: "var(--bg-card)" }}
    >
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--text-tertiary)]">
          Propuestas express
        </span>
        <button className="btn-secondary text-[13px]" onClick={createList}>
          + Nueva propuesta
        </button>
      </div>

      {/* Lista de shortlists */}
      {loading ? (
        <p className="py-4 text-center text-[13px] text-[color:var(--text-tertiary)]">
          Cargando…
        </p>
      ) : (
        <ul className="space-y-2">
          {lists.map((s) => (
            <li key={s.id}>
              <button
                className="flex w-full items-center justify-between rounded border px-3 py-2 text-left text-[13px] hover:opacity-80"
                style={{ borderColor: "var(--border-subtle)" }}
                onClick={() => refreshActive(s.id).then(() => setActive((a) => a?.id === s.id ? a : lists.find(l => l.id === s.id) ?? null))}
              >
                <span className="font-medium text-[color:var(--text-primary)]">
                  {s.title}{" "}
                  <span className="text-[color:var(--text-tertiary)]">
                    · {s.items.length} unidad{s.items.length !== 1 ? "es" : ""}
                  </span>
                </span>
                <span className="shrink-0 text-[11px] text-[color:var(--text-tertiary)]">
                  {statusLabel(s.status)}
                  {s._count ? ` · ${s._count.views} vistas` : ""}
                </span>
              </button>
            </li>
          ))}
          {lists.length === 0 && (
            <li className="py-4 text-center text-[13px] text-[color:var(--text-tertiary)]">
              Aún no hay propuestas. Crea una para empezar.
            </li>
          )}
        </ul>
      )}

      {/* Panel de edición de la propuesta activa */}
      {active && (
        <div
          className="mt-4 rounded border p-3"
          style={{ borderColor: "var(--border-default)" }}
        >
          {/* Encabezado de la propuesta activa */}
          <div className="flex items-center justify-between">
            <strong className="text-[13px] text-[color:var(--text-primary)]">
              {active.title}
            </strong>
            <button className="btn-primary text-[13px]" onClick={generateLink}>
              Generar y copiar link
            </button>
          </div>

          {/* Unidades en la propuesta */}
          {active.items.length > 0 ? (
            <ul className="mt-3 space-y-1">
              {active.items.map((i) => (
                <li
                  key={i.id}
                  className="flex items-center justify-between text-[13px]"
                >
                  <span className="text-[color:var(--text-secondary)]">
                    {snapshotLabel(i.snapshot)}{" "}
                    <span className="text-[color:var(--text-tertiary)]">
                      · {snapshotType(i.snapshot)}
                    </span>{" "}
                    · {snapshotPrice(i.snapshot)}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      className="text-xs text-[color:var(--text-secondary)] hover:underline disabled:opacity-40"
                      disabled={!active.dealId}
                      title={active.dealId ? "Crear cotización de esta unidad" : "Vincula la propuesta a un negocio para cotizar"}
                      onClick={() => promover(i)}
                    >
                      Cotizar
                    </button>
                    <button
                      className="text-[11px] text-[color:var(--text-tertiary)] hover:text-[color:var(--text-primary)]"
                      onClick={() => removeUnit(i.id)}
                    >
                      Quitar
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-[13px] text-[color:var(--text-tertiary)]">
              Sin unidades. Busca y agrega desde el Hub.
            </p>
          )}

          {/* Buscador de unidades */}
          <div className="mt-3">
            <input
              className="form-input w-full text-[13px]"
              placeholder="Buscar unidad del Hub…"
              value={search}
              onChange={(e) => searchUnits(e.target.value)}
            />
            {results.length > 0 && (
              <ul className="mt-2 max-h-48 space-y-1 overflow-auto">
                {results.map((u) => (
                  <li key={u.id}>
                    <button
                      className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-[13px] hover:opacity-80"
                      style={{ borderColor: "var(--border-subtle)" }}
                      onClick={() => addUnit(u)}
                    >
                      <span className="text-[color:var(--text-secondary)]">
                        {u.unitNumber} · {u.unitType}
                      </span>
                      <span className="text-[color:var(--text-tertiary)]">
                        {money(u.price, u.moneda)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
