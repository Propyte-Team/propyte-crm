"use client";
// J1 (#985) — Embudo del Journey: una tarjeta por paso del recorrido del cliente (estado del
// contacto), con cuántos hay hoy, cuántos entraron, cuántos avanzaron, cuánto suelen tardar y las
// reglas que actúan ahí. Datos de GET /api/admin/journey/embudo.
import { useCallback, useEffect, useMemo, useState } from "react";
import { leerError } from "@/lib/api-errors";
import { PLAZA_LABELS } from "@/lib/constants";
import { ESTADO_COLORS, ESTADO_LABELS, etiquetaEstado } from "@/lib/estados";
import { FLUJO_LABELS, FLUJO_ORDER, FLUJO_SIN_FLUJO, FLUJO_VACIO_LABEL } from "@/lib/flujos";
import { CUALQUIER_MOMENTO, porcentajeAvance, type PasoEmbudo, type SalidaEmbudo } from "@/lib/journey/embudo";

interface ReglaDelPaso { id: string; name: string; isActive: boolean; paso: string }
interface RespuestaEmbudo {
  dias: number;
  plazaFija: string | null;
  pasos: PasoEmbudo[];
  salidas: SalidaEmbudo[];
  especiales: SalidaEmbudo[];
  porClasificar: number;
  reglas: ReglaDelPaso[];
}
interface Asesor { id: string; name: string; role: string; plaza: string | null; isActive?: boolean }

const ROLES_ASESOR = ["ASESOR_SR", "ASESOR_JR", "TEAM_LEADER"];
const num = (n: number) => n.toLocaleString("es-MX");
const SELECT = "rounded-md border border-neutral-300 bg-transparent px-2 py-1 text-xs dark:border-neutral-700";

function duracion(n: number): string {
  if (n < 1) return "menos de 1 día";
  const r = Math.round(n * 10) / 10;
  return `${r.toLocaleString("es-MX")} ${r === 1 ? "día" : "días"}`;
}

function Pastilla({ regla, onAbrir }: { regla: ReglaDelPaso; onAbrir?: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onAbrir?.(regla.id)}
      title={`${regla.name} · ${regla.isActive ? "encendida" : "apagada"}. Clic para ver su flujo`}
      className={`inline-flex max-w-full items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${
        regla.isActive
          ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"
          : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
      }`}
    >
      <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${regla.isActive ? "bg-green-500" : "bg-neutral-400"}`} />
      <span className="truncate">{regla.name}</span>
      <span className="sr-only">{regla.isActive ? " (encendida)" : " (apagada)"}</span>
    </button>
  );
}

function TarjetaPaso({ paso, reglas, onAbrirRegla }: { paso: PasoEmbudo; reglas: ReglaDelPaso[]; onAbrirRegla?: (id: string) => void }) {
  const color = ESTADO_COLORS[paso.estado];
  const pct = porcentajeAvance(paso.entraron, paso.avanzaron);
  return (
    <li className="flex w-52 shrink-0 flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <div className="h-1.5" style={{ backgroundColor: color }} />
      <div className="flex flex-1 flex-col gap-2 p-3">
        <h3 className="text-sm font-semibold" style={{ color }}>{ESTADO_LABELS[paso.estado]}</h3>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-neutral-500">Hoy</p>
          <p className="text-2xl font-semibold leading-none tabular-nums">{num(paso.hoy)}</p>
        </div>
        <dl className="space-y-1 text-xs text-neutral-600 dark:text-neutral-400">
          <div className="flex justify-between gap-2">
            <dt>Entraron</dt>
            <dd className="font-medium tabular-nums text-neutral-900 dark:text-neutral-100">{num(paso.entraron)}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>{pct !== null ? "Avanzó" : "Avanzaron"}</dt>
            <dd className="font-medium tabular-nums text-neutral-900 dark:text-neutral-100">
              {paso.entraron === 0 ? "—" : pct !== null ? `${pct} %` : num(paso.avanzaron)}
            </dd>
          </div>
        </dl>
        <p className="text-xs text-neutral-600 dark:text-neutral-400">
          {paso.medianaDias !== null
            ? <>Suelen tardar <strong className="text-neutral-900 dark:text-neutral-100">{duracion(paso.medianaDias)}</strong></>
            : "Aún sin datos de tiempo"}
        </p>
        {paso.atorados > 0 && (
          <a
            href={`/contacts?estado=${paso.estado}`}
            className="text-xs font-medium text-amber-700 underline underline-offset-2 dark:text-amber-400"
            title={`Ver los contactos en ${ESTADO_LABELS[paso.estado]}`}
          >
            {num(paso.atorados)} {paso.atorados === 1 ? "atorado" : "atorados"}
          </a>
        )}
        {reglas.length > 0 && (
          <div className="mt-auto flex flex-wrap gap-1 border-t border-neutral-100 pt-2 dark:border-neutral-800">
            {reglas.map((r) => <Pastilla key={r.id} regla={r} onAbrir={onAbrirRegla} />)}
          </div>
        )}
      </div>
    </li>
  );
}

function Contador({ s }: { s: SalidaEmbudo }) {
  const color = ESTADO_COLORS[s.estado];
  return (
    <li
      className="min-w-[11rem] rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900"
      style={{ borderLeft: `4px solid ${color}` }}
    >
      <p className="text-sm font-semibold" style={{ color }}>{ESTADO_LABELS[s.estado]}</p>
      <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
        <strong className="text-base tabular-nums text-neutral-900 dark:text-neutral-100">{num(s.hoy)}</strong> hoy · {num(s.entraron)} entraron
      </p>
      {s.desde.length > 0 && (
        <p className="mt-1 text-[11px] text-neutral-500">
          Salieron de: {s.desde.map((d) => `${etiquetaEstado(d.estado)} ${num(d.n)}`).join(" · ")}
        </p>
      )}
    </li>
  );
}

export function Embudo({ onAbrirRegla }: { onAbrirRegla?: (id: string) => void }) {
  const [ventana, setVentana] = useState("30");
  const [plaza, setPlaza] = useState("");
  const [flujo, setFlujo] = useState("");
  const [asesor, setAsesor] = useState("");
  const [asesores, setAsesores] = useState<Asesor[]>([]);
  const [datos, setDatos] = useState<RespuestaEmbudo | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    let cancelar = false;
    fetch("/api/users?basic=true&isActive=true")
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((j) => {
        if (cancelar) return;
        setAsesores(((j.data ?? []) as Asesor[]).filter((u) => ROLES_ASESOR.includes(u.role) && u.isActive !== false));
      })
      .catch(() => {});
    return () => { cancelar = true; };
  }, []);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      setCargando(true);
      setError(null);
      try {
        const q = new URLSearchParams({ dias: ventana });
        if (plaza) q.set("plaza", plaza);
        if (flujo) q.set("flujo", flujo);
        if (asesor) q.set("asesor", asesor);
        const res = await fetch(`/api/admin/journey/embudo?${q}`);
        if (!res.ok) throw new Error(await leerError(res, "No se pudo cargar el embudo"));
        const j = (await res.json()) as RespuestaEmbudo;
        if (!cancelado) setDatos(j);
      } catch (e) {
        if (!cancelado) setError(e instanceof Error && e.message ? e.message : "No se pudo cargar el embudo. Revisa tu conexión.");
      } finally {
        if (!cancelado) setCargando(false);
      }
    })();
    return () => { cancelado = true; };
  }, [ventana, plaza, flujo, asesor, intento]);

  const asesoresVisibles = useMemo(() => {
    const p = datos?.plazaFija || plaza;
    return asesores.filter((a) => !p || a.plaza === p).sort((a, b) => a.name.localeCompare(b.name, "es"));
  }, [asesores, plaza, datos?.plazaFija]);

  const reglasPorPaso = useMemo(() => {
    const m = new Map<string, ReglaDelPaso[]>();
    for (const r of datos?.reglas ?? []) m.set(r.paso, [...(m.get(r.paso) ?? []), r]);
    return m;
  }, [datos]);
  const reglasSueltas = reglasPorPaso.get(CUALQUIER_MOMENTO) ?? [];

  return (
    <section aria-labelledby="embudo-titulo" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="embudo-titulo" className="text-lg font-semibold tracking-tight">Embudo del cliente</h2>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <select
            value={plaza}
            onChange={(e) => { setPlaza(e.target.value); setAsesor(""); }}
            disabled={!!datos?.plazaFija}
            className={SELECT}
            aria-label="Plaza"
          >
            {datos?.plazaFija ? (
              <option value="">{PLAZA_LABELS[datos.plazaFija] ?? datos.plazaFija}</option>
            ) : (
              <>
                <option value="">Todas las plazas</option>
                {Object.entries(PLAZA_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </>
            )}
          </select>
          <select value={flujo} onChange={(e) => setFlujo(e.target.value)} className={SELECT} aria-label="Flujo comercial">
            <option value="">Todos los flujos</option>
            {FLUJO_ORDER.map((f) => <option key={f} value={f}>{FLUJO_LABELS[f]}</option>)}
            <option value={FLUJO_SIN_FLUJO}>{FLUJO_VACIO_LABEL}</option>
          </select>
          <select value={asesor} onChange={(e) => setAsesor(e.target.value)} className={SELECT} aria-label="Asesor">
            <option value="">Todos los asesores</option>
            {asesoresVisibles.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <select value={ventana} onChange={(e) => setVentana(e.target.value)} className={SELECT} aria-label="Ventana de tiempo">
            <option value="7">Últimos 7 días</option>
            <option value="30">Últimos 30 días</option>
            <option value="90">Últimos 90 días</option>
          </select>
        </div>
      </div>

      <p className="text-xs text-neutral-500">
        «Hoy» es la foto actual. Entradas, avances y tiempos cuentan los movimientos registrados desde el 3 de noviembre de 2026,
        así que los números son pequeños mientras se acumula historial.
        {datos && datos.porClasificar > 0 && <> {num(datos.porClasificar)} contactos están por clasificar.</>}
      </p>

      {error && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
        >
          <span>{error}</span>
          <button type="button" onClick={() => setIntento((n) => n + 1)} className="rounded border border-red-300 px-2 py-0.5 text-xs font-medium">
            Reintentar
          </button>
        </div>
      )}

      {!datos && cargando && (
        <ul aria-busy="true" aria-label="Cargando embudo" className="flex gap-3 overflow-hidden">
          {Array.from({ length: 6 }).map((_, i) => (
            <li key={i} className="h-44 w-52 shrink-0 animate-pulse rounded-lg bg-neutral-100 dark:bg-neutral-800" />
          ))}
        </ul>
      )}

      {datos && (
        <div className={cargando ? "opacity-60 transition-opacity" : "transition-opacity"} aria-busy={cargando}>
          <ul className="flex gap-3 overflow-x-auto pb-2">
            {datos.pasos.map((p) => (
              <TarjetaPaso key={p.estado} paso={p} reglas={reglasPorPaso.get(p.estado) ?? []} onAbrirRegla={onAbrirRegla} />
            ))}
          </ul>

          <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">En cualquier momento</h3>
              {reglasSueltas.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {reglasSueltas.map((r) => <Pastilla key={r.id} regla={r} onAbrir={onAbrirRegla} />)}
                </div>
              ) : (
                <p className="text-xs text-neutral-500">Ninguna regla actúa sin importar el paso.</p>
              )}
              <p className="mt-2 text-[11px] text-neutral-500">Reglas por evento (lead nuevo, pago vencido) o por tiempo sin actividad.</p>
            </div>
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">Salidas y casos aparte</h3>
              <ul className="flex flex-wrap gap-2">
                {[...datos.salidas, ...datos.especiales].map((s) => <Contador key={s.estado} s={s} />)}
              </ul>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
