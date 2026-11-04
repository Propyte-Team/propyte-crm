// Resumen de todas las reglas a la vez: por regla, cuántas acciones se dispararon, se completaron
// y fallaron. Pura: recibe las filas ya agrupadas (ruleId + status + cuántas) y las reglas.

export interface FilaAgrupada {
  ruleId: string | null;
  status: string;
  n: number;
}

export interface ReglaMin {
  id: string;
  name: string;
  isActive: boolean;
}

export interface ResumenDeRegla {
  ruleId: string;
  nombre: string;
  activa: boolean;
  /** Acciones que la regla puso en cola (todas, sin importar cómo terminaron). */
  disparos: number;
  completadas: number;
  fallidas: number;
  /** Aún en cola, en curso u omitidas. */
  otras: number;
}

export type OrdenResumen = "disparos" | "fallidas" | "nombre";

export function armarResumenReglas(filas: FilaAgrupada[], reglas: ReglaMin[]): ResumenDeRegla[] {
  const porRegla = new Map<string, ResumenDeRegla>();
  for (const r of reglas) {
    porRegla.set(r.id, { ruleId: r.id, nombre: r.name, activa: r.isActive, disparos: 0, completadas: 0, fallidas: 0, otras: 0 });
  }
  for (const f of filas) {
    if (!f.ruleId) continue;
    const fila = porRegla.get(f.ruleId);
    if (!fila) continue; // regla borrada
    fila.disparos += f.n;
    if (f.status === "DONE") fila.completadas += f.n;
    else if (f.status === "FAILED") fila.fallidas += f.n;
    else fila.otras += f.n;
  }
  return [...porRegla.values()];
}

export function ordenarResumen(filas: ResumenDeRegla[], orden: OrdenResumen): ResumenDeRegla[] {
  const copia = [...filas];
  if (orden === "nombre") return copia.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  const clave = orden === "fallidas" ? "fallidas" : "disparos";
  return copia.sort((a, b) => b[clave] - a[clave] || b.disparos - a.disparos || a.nombre.localeCompare(b.nombre, "es"));
}

/** % de las acciones terminadas que fallaron (null si ninguna terminó todavía). */
export function porcentajeFallo(r: Pick<ResumenDeRegla, "completadas" | "fallidas">): number | null {
  const terminadas = r.completadas + r.fallidas;
  return terminadas === 0 ? null : Math.round((r.fallidas / terminadas) * 100);
}
