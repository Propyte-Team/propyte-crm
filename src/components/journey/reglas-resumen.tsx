"use client";
// Tabla con las métricas de todas las reglas a la vez (una sola consulta agregada).
import { useEffect, useMemo, useState } from "react";
import { leerError } from "@/lib/api-errors";
import { ordenarResumen, porcentajeFallo, type OrdenResumen, type ResumenDeRegla } from "@/lib/journey/resumen-reglas";

interface Props {
  window: "7" | "30" | "90" | "all";
  onAbrir: (ruleId: string) => void;
}

export function ReglasResumen({ window: ventana, onAbrir }: Props) {
  const [filas, setFilas] = useState<ResumenDeRegla[] | null>(null);
  const [error, setError] = useState("");
  const [orden, setOrden] = useState<OrdenResumen>("disparos");

  useEffect(() => {
    let cancel = false;
    setFilas(null);
    setError("");
    fetch(`/api/admin/journey/metrics/resumen?window=${ventana}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(await leerError(r, "No se pudieron cargar las métricas"));
        return r.json() as Promise<{ reglas: ResumenDeRegla[] }>;
      })
      .then((j) => { if (!cancel) setFilas(j.reglas); })
      .catch((e) => { if (!cancel) setError(e instanceof Error ? e.message : "No se pudieron cargar las métricas"); });
    return () => { cancel = true; };
  }, [ventana]);

  const ordenadas = useMemo(() => (filas ? ordenarResumen(filas, orden) : []), [filas, orden]);
  const periodo = ventana === "all" ? "todo el histórico" : `los últimos ${ventana} días`;

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold">Todas las reglas · {periodo}</h2>
        <label className="ml-auto flex items-center gap-2 text-xs text-neutral-500">
          Ordenar por
          <select value={orden} onChange={(e) => setOrden(e.target.value as OrdenResumen)} className="rounded-md border border-neutral-300 bg-transparent px-2 py-1 text-xs">
            <option value="disparos">Más disparos</option>
            <option value="fallidas">Más fallos</option>
            <option value="nombre">Nombre</option>
          </select>
        </label>
      </div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {!error && !filas && <p className="text-sm text-neutral-500">Cargando métricas…</p>}
      {filas && ordenadas.length === 0 && <p className="text-sm text-neutral-500">No hay reglas.</p>}
      {filas && ordenadas.length > 0 && (
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="text-neutral-500">
              <th className="pb-2 pr-3 font-medium">Regla</th>
              <th className="pb-2 pr-3 text-right font-medium">Se disparó</th>
              <th className="pb-2 pr-3 text-right font-medium">Se completó</th>
              <th className="pb-2 pr-3 text-right font-medium">Falló</th>
              <th className="pb-2 font-medium">Estado</th>
            </tr>
          </thead>
          <tbody>
            {ordenadas.map((r) => {
              const pct = porcentajeFallo(r);
              return (
                <tr key={r.ruleId} className="border-t border-neutral-200 dark:border-neutral-800">
                  <td className="py-2 pr-3">
                    <button type="button" onClick={() => onAbrir(r.ruleId)} className="text-left font-medium underline-offset-2 hover:underline">{r.nombre}</button>
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{r.disparos}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{r.completadas}</td>
                  <td className={`py-2 pr-3 text-right tabular-nums ${r.fallidas > 0 ? "font-medium text-red-600" : ""}`}>
                    {r.fallidas}{pct !== null && r.fallidas > 0 ? ` (${pct}%)` : ""}
                  </td>
                  <td className="py-2 text-neutral-500">{r.activa ? "Activa" : "Pausada"}{r.disparos === 0 ? " · sin disparos" : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <p className="mt-3 text-[11px] text-neutral-400">Cada acción que una regla pone en cola cuenta como un disparo; «Se completó» y «Falló» dicen cómo terminó.</p>
    </div>
  );
}
