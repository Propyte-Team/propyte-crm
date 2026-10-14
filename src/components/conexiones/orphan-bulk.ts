// Asignación masiva del panel «Leads huérfanos» (2026-10-14, #883) — la parte PURA del cliente:
// qué renglones se pueden marcar, cómo se parte la selección en peticiones y cómo se cuenta el
// resultado. Vive aparte de la vista para probarla sin React (vitest corre en node).
import { esCuentaTecnica } from "@/lib/workflows/ruteables";
import type { OrphanLeads } from "@/server/orphan-leads";

/**
 * ¿Este renglón entra en «Seleccionar todos»? Los mismos que el servidor acepta en el modo panel de
 * assignContact: sin dueño o con dueño técnico. Un renglón de «cuenta sin registrar» con dueño de
 * verdad queda fuera —se reasigna de uno en uno, a propósito— para que un «Seleccionar todos» no le
 * quite un lead a nadie.
 */
export function esMarcable(owner: { email: string } | null): boolean {
  return owner === null || esCuentaTecnica(owner.email);
}

/** Contactos marcables de una sección, sin repetir. `id` dice qué campo es el contacto. */
export function marcablesDe<T extends { owner: { email: string } | null }>(
  rows: readonly T[],
  id: (row: T) => string,
): string[] {
  return [...new Set(rows.filter((r) => esMarcable(r.owner)).map(id))];
}

/** Contactos marcables de todo el panel, sin repetir (un contacto puede salir en dos secciones). */
export function contactosMarcables(data: OrphanLeads): string[] {
  return [
    ...new Set([
      ...marcablesDe(data.unowned.rows, (r) => r.id),
      ...marcablesDe(data.technical.rows, (r) => r.id),
      ...marcablesDe(data.unregistered.rows, (r) => r.contactId),
    ]),
  ];
}

/** Parte la selección en peticiones de a lo más `max` (el tope del servidor). */
export function enLotes<T>(items: readonly T[], max: number): T[][] {
  const size = Math.max(1, Math.floor(max));
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export type ResultadoLoteCliente = {
  asignados: number;
  yaEranSuyos: number;
  fallidos: { contactId: string; code: string }[];
};

// Frases que sirven para 1 y para varios: «2 con dueño», «1 con cambios recientes».
const MOTIVO: Record<string, string> = {
  "ya-asignado": "con dueño",
  "no-existe": "borrados o fuera de tus marcas",
  conflicto: "con cambios recientes (vuelve a intentar)",
  "sin-permiso": "sin permiso",
  "usuario-invalido": "que la persona elegida no puede recibir",
  error: "por un error del servidor (vuelve a intentar)",
};

/** Suma los resultados de varias peticiones. */
export function sumarResultados(partes: readonly ResultadoLoteCliente[]): ResultadoLoteCliente {
  return partes.reduce<ResultadoLoteCliente>(
    (acc, p) => ({
      asignados: acc.asignados + p.asignados,
      yaEranSuyos: acc.yaEranSuyos + p.yaEranSuyos,
      fallidos: [...acc.fallidos, ...p.fallidos],
    }),
    { asignados: 0, yaEranSuyos: 0, fallidos: [] },
  );
}

const plural = (n: number, uno: string, varios: string) => (n === 1 ? `1 ${uno}` : `${n} ${varios}`);

/** Frase para el aviso de la página: qué pasó, con cifras, y por qué falló lo que falló. */
export function resumenLote(r: ResultadoLoteCliente, nombre: string): string {
  const partes = [`${plural(r.asignados, "prospecto asignado", "prospectos asignados")} a ${nombre}.`];
  if (r.yaEranSuyos > 0) partes.push(`${plural(r.yaEranSuyos, "ya era suyo", "ya eran suyos")}.`);
  if (r.fallidos.length > 0) {
    const porMotivo = new Map<string, number>();
    for (const f of r.fallidos) porMotivo.set(f.code, (porMotivo.get(f.code) ?? 0) + 1);
    const detalle = [...porMotivo].map(([code, n]) => `${n} ${MOTIVO[code] ?? code}`).join(", ");
    partes.push(`${plural(r.fallidos.length, "no se pudo", "no se pudieron")}: ${detalle}.`);
  }
  return partes.join(" ");
}
