"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { leerError } from "@/lib/api-errors";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/use-toast";
import { DuplicadosHistorial } from "./duplicados-historial";
import { SIN_ASESOR, armarComparativa, asesoresDeGrupos, filtrarGruposPorAsesor } from "./duplicados-comparar";
import { descripcionFusion, resumenFusion, type ResumenFusion } from "./duplicados-model";

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
  /** Firma estable del grupo (la calcula el servidor) */
  key: string;
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
      {matchType === "strong" ? "Mismo teléfono o correo" : "Nombre parecido"}
    </span>
  );
}

// Campos clave en filas y un contacto por columna; las filas con diferencias van resaltadas.
function Comparativa({ contacts, principalId }: { contacts: Ct[]; principalId?: string }) {
  const filas = armarComparativa(contacts);
  return (
    <div className="mb-3 overflow-x-auto rounded border" style={{ borderColor: "var(--border-subtle)" }}>
      <table className="w-full text-left text-[12px]">
        <thead>
          <tr className="text-[color:var(--text-tertiary)]">
            <th className="px-2 py-1.5 font-medium">Campo</th>
            {contacts.map((c, i) => (
              <th key={c.id} className="px-2 py-1.5 font-medium">
                Contacto {i + 1}{c.id === principalId ? " · principal" : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.clave} className="border-t" style={{ borderColor: "var(--border-subtle)", background: f.difiere ? "var(--color-warning-bg, rgba(245,158,11,0.12))" : undefined }}>
              <th scope="row" className="px-2 py-1.5 font-medium text-[color:var(--text-secondary)]">
                {f.etiqueta}{f.difiere && <span className="ml-1 text-[10px] font-normal text-[color:var(--text-tertiary)]">(distinto)</span>}
              </th>
              {f.valores.map((v, i) => (
                <td key={contacts[i].id} className={`px-2 py-1.5 ${f.difiere ? "font-medium text-[color:var(--text-primary)]" : "text-[color:var(--text-tertiary)]"}`}>{v}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface Meta {
  total: number;
  totalFuertes: number;
  totalNombre: number;
  filtrados: number;
  hayMas: boolean;
}

const PAGINA = 20;
type Tab = "strong" | "name";

export function DuplicadosClient() {
  const confirmar = useConfirm();
  const [groups, setGroups] = useState<DupGroup[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [tab, setTab] = useState<Tab>("strong");
  const [loading, setLoading] = useState(true);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [survivors, setSurvivors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [asesor, setAsesor] = useState("");
  const [comparando, setComparando] = useState<Record<string, boolean>>({});
  const [version, setVersion] = useState(0);
  const [resultados, setResultados] = useState<Array<ResumenFusion & { id: number }>>([]);

  const asesores = useMemo(() => asesoresDeGrupos(groups), [groups]);
  const visibles = useMemo(() => filtrarGruposPorAsesor(groups, asesor), [groups, asesor]);

  // offset 0 reemplaza la lista; offset > 0 ("Cargar más") la acumula.
  const load = useCallback(async (offset = 0) => {
    if (offset === 0) setLoading(true); else setCargandoMas(true);
    const res = await fetch(`/api/contacts/duplicates?tipo=${tab}&limit=${PAGINA}&offset=${offset}`);
    if (!res.ok) {
      toast({ title: "No se pudieron cargar los duplicados", description: await leerError(res), variant: "destructive" });
      setLoading(false);
      setCargandoMas(false);
      return;
    }
    const json = await res.json().catch(() => ({}));
    const data: DupGroup[] = json.data ?? [];
    setMeta(json.meta ?? null);
    setGroups((prev) => (offset === 0 ? data : [...prev, ...data]));
    setSurvivors((prev) => {
      const def: Record<string, string> = offset === 0 ? {} : { ...prev };
      for (const g of data) def[g.key] = elegirPrincipal(g.contacts).id;
      return def;
    });
    setLoading(false);
    setCargandoMas(false);
    if (offset === 0) setVersion((v) => v + 1);
  }, [tab]);

  useEffect(() => {
    load(0);
  }, [load]);

  async function mergeGroup(g: DupGroup) {
    const survivorId = survivors[g.key];
    if (!survivorId) return;
    const principal = g.contacts.find((c) => c.id === survivorId)!;
    const losers = g.contacts.filter((c) => c.id !== survivorId);
    const ok = await confirmar({
      titulo: `¿Fusionar ${losers.length} ${losers.length === 1 ? "contacto" : "contactos"} en el contacto principal?`,
      descripcion: descripcionFusion(principal, losers),
      confirmar: "Fusionar",
      peligroso: true,
    });
    if (!ok) return;
    setBusy(true);
    let fusionados = 0;
    let error: string | undefined;
    for (const l of losers) {
      const res = await fetch("/api/contacts/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ survivorId, loserId: l.id }),
      });
      if (!res.ok) {
        error = await leerError(res, "Error al fusionar");
        break;
      }
      fusionados++;
    }
    setBusy(false);
    const resumen = resumenFusion({ fusionados, total: losers.length, error });
    setResultados((prev) => [{ ...resumen, id: Date.now() }, ...prev].slice(0, 5));
    toast({ title: resumen.titulo, description: resumen.detalle, variant: resumen.tono === "ok" ? undefined : "destructive" });
    await load(0);
  }

  async function noEsDuplicado(g: DupGroup) {
    const ok = await confirmar({
      titulo: "¿Marcar como que no son la misma persona?",
      descripcion: "Este grupo dejará de aparecer en la lista. No se modifica ningún contacto.",
      confirmar: "No es duplicado",
    });
    if (!ok) return;
    const res = await fetch("/api/contacts/duplicates/revisados", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: g.contacts.map((c) => c.id) }),
    });
    if (!res.ok) {
      toast({ title: "No se pudo guardar", description: await leerError(res), variant: "destructive" });
      return;
    }
    toast({ title: "Grupo marcado como no duplicado" });
    await load(0);
  }

  return (
    <div className="space-y-5 p-6">
      <div>
        <h1 className="text-xl font-semibold text-[color:var(--text-primary)]">
          Contactos duplicados
        </h1>
        <p className="text-[13px] text-[color:var(--text-tertiary)]">
          Elige el contacto principal; los demás se unen a él. Si no son la misma persona, márcalo y el grupo deja de aparecer.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {([["strong", "Seguras (mismo teléfono o correo)", meta?.totalFuertes], ["name", "Por revisar (nombre parecido)", meta?.totalNombre]] as const).map(([t, texto, n]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="rounded border px-3 py-1.5 text-[13px]"
            style={{
              borderColor: tab === t ? "var(--color-teal, #0D9488)" : "var(--border-default)",
              color: tab === t ? "var(--text-primary)" : "var(--text-secondary)",
            }}
          >
            {texto}{n !== undefined ? ` (${n})` : ""}
          </button>
        ))}
      </div>

      {!loading && (asesores.nombres.length > 0 || asesores.haySinAsesor) && (
        <label className="flex flex-wrap items-center gap-2 text-[13px] text-[color:var(--text-secondary)]">
          Asesor asignado
          <select className="form-input !w-auto text-[13px]" value={asesor} onChange={(e) => setAsesor(e.target.value)}>
            <option value="">Todos</option>
            {asesores.nombres.map((n) => <option key={n} value={n}>{n}</option>)}
            {asesores.haySinAsesor && <option value={SIN_ASESOR}>Sin asesor</option>}
          </select>
          {asesor && <span className="text-[12px] text-[color:var(--text-tertiary)]">{visibles.length} de {groups.length} grupos cargados</span>}
        </label>
      )}

      {resultados.length > 0 && (
        <div className="space-y-1">
          {resultados.map((r) => (
            <div key={r.id} className="rounded border px-3 py-2 text-[12px]" style={{ borderColor: r.tono === "ok" ? "var(--border-subtle)" : "var(--color-warning)" }}>
              <p className="font-medium text-[color:var(--text-primary)]">{r.titulo}</p>
              {r.detalle && <p className="text-[color:var(--text-tertiary)]">{r.detalle}</p>}
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <p className="text-[13px] text-[color:var(--text-tertiary)]">Cargando…</p>
      ) : visibles.length === 0 ? (
        <p className="text-[13px] text-[color:var(--text-tertiary)]">
          {groups.length === 0 ? "No hay grupos en esta lista." : "Ningún grupo cargado tiene contactos de ese asesor."}
        </p>
      ) : (
        <div className="space-y-4">
          {visibles.map((g) => (
            <div
              key={g.key}
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
                <div className="flex flex-wrap gap-2">
                  <button
                    className="btn-secondary text-xs"
                    aria-expanded={!!comparando[g.key]}
                    onClick={() => setComparando((p) => ({ ...p, [g.key]: !p[g.key] }))}
                  >
                    {comparando[g.key] ? "Ocultar comparación" : "Comparar lado a lado"}
                  </button>
                  <button
                    className="btn-secondary text-xs disabled:opacity-40"
                    disabled={busy}
                    onClick={() => noEsDuplicado(g)}
                  >
                    No es duplicado
                  </button>
                  <button
                    className="btn-primary text-xs disabled:opacity-40"
                    disabled={busy}
                    onClick={() => mergeGroup(g)}
                  >
                    Fusionar en el contacto principal
                  </button>
                </div>
              </div>
              {comparando[g.key] && <Comparativa contacts={g.contacts} principalId={survivors[g.key]} />}
              <div className="grid gap-2 sm:grid-cols-2">
                {g.contacts.map((c) => (
                  <label
                    key={c.id}
                    className="flex cursor-pointer items-start gap-2 rounded border p-2 text-[13px]"
                    style={{ borderColor: "var(--border-subtle)" }}
                  >
                    <input
                      type="radio"
                      name={`surv-${g.key}`}
                      checked={survivors[g.key] === c.id}
                      onChange={() =>
                        setSurvivors((s) => ({ ...s, [g.key]: c.id }))
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
          {meta?.hayMas && (
            <button className="btn-secondary text-xs disabled:opacity-40" disabled={cargandoMas} onClick={() => load(groups.length)}>
              {cargandoMas ? "Cargando…" : `Cargar más (${groups.length} de ${meta.filtrados})`}
            </button>
          )}
        </div>
      )}
      <DuplicadosHistorial version={version} onCambio={() => load(0)} />
    </div>
  );
}
