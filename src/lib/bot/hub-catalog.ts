// HubCatalog del agente — proyección read-only del catálogo PUBLICADO en propyte.com.
// Delega en src/lib/hub/catalog.ts: el gate público (approved_at IS NOT NULL AND
// deleted_at IS NULL) vive allí, escrito una sola vez.
//
// Devuelve { data, error } a propósito: el bot NO debe decir "no tengo inventario"
// cuando en realidad la consulta falló. Los callers deben propagar esa distinción
// (omitir el brief / escalar), nunca tratar error como catálogo vacío.
import { searchCatalog } from "@/lib/hub/catalog";
import type { CatalogResult } from "@/lib/hub/catalog-types";

export interface HubDevelopmentSummary {
  id: string;
  nombre: string;
  zona: string | null;
  ciudad: string | null;
  precio_min: number | null;
  precio_max: number | null;
  moneda: string | null;
  /** Unidades publicadas del desarrollo que encajaron en la búsqueda (no el total del dev). */
  unidades_publicadas: number;
  recamaras_min: number | null;
  recamaras_max: number | null;
  enganche_pct: number | null;
  meses_opciones: number[] | null;
}

function minOf(values: (number | null)[]): number | null {
  const nums = values.filter((v): v is number => v != null);
  return nums.length ? Math.min(...nums) : null;
}

function maxOf(values: (number | null)[]): number | null {
  const nums = values.filter((v): v is number => v != null);
  return nums.length ? Math.max(...nums) : null;
}

/**
 * Desarrollos publicados que encajan con el perfil (para data-gate del bot y matching),
 * agregados desde sus unidades vía searchCatalog. Propaga { data, error } de la capa
 * de catálogo: un fallo de consulta nunca se disfraza de "sin inventario".
 */
export async function findMatchingDevelopments(opts: {
  budgetMin?: number | null;
  budgetMax?: number | null;
  zone?: string | null;
  city?: string | null;
  bedrooms?: number | null;
  limit?: number;
}): Promise<CatalogResult<HubDevelopmentSummary[]>> {
  const maxDevs = Math.min(opts.limit ?? 3, 10);
  // Se piden más unidades que desarrollos porque varias unidades caen en el mismo dev.
  const { data: units, error } = await searchCatalog({
    budgetMin: opts.budgetMin ?? null,
    budgetMax: opts.budgetMax ?? null,
    zone: opts.zone ?? null,
    city: opts.city ?? null,
    bedrooms: opts.bedrooms ?? null,
    limit: 25,
  });
  if (error) return { data: [], error };

  const byDev = new Map<string, typeof units>();
  for (const u of units) {
    if (!u.developmentId) continue;
    const bucket = byDev.get(u.developmentId);
    if (bucket) bucket.push(u);
    else byDev.set(u.developmentId, [u]);
  }

  const summaries: HubDevelopmentSummary[] = [...byDev.entries()].map(([id, us]) => ({
    id,
    nombre: us[0].developmentName ?? "Sin nombre",
    zona: us[0].zone,
    ciudad: us[0].city,
    precio_min: minOf(us.map((u) => u.priceMxn)),
    precio_max: maxOf(us.map((u) => u.priceMxn)),
    moneda: us[0].currency ?? "MXN",
    unidades_publicadas: us.length,
    recamaras_min: minOf(us.map((u) => u.bedrooms)),
    recamaras_max: maxOf(us.map((u) => u.bedrooms)),
    enganche_pct: us.find((u) => u.finEnganchePct != null)?.finEnganchePct ?? null,
    meses_opciones: us.find((u) => u.finMesesOpciones?.length)?.finMesesOpciones ?? null,
  }));

  summaries.sort((a, b) => (a.precio_min ?? Infinity) - (b.precio_min ?? Infinity));
  return { data: summaries.slice(0, maxDevs), error: null };
}

export function catalogBrief(devs: HubDevelopmentSummary[]): string {
  if (devs.length === 0) return "";
  const money = (n: number) => `$${Math.round(n).toLocaleString("es-MX")}`;
  const lines = devs.map((d) => {
    const partes: string[] = [`• ${d.nombre}`];
    const ubic = [d.zona, d.ciudad].filter(Boolean).join(", ");
    if (ubic) partes.push(`(${ubic})`);
    if (d.precio_min != null) {
      partes.push(
        d.precio_max != null && d.precio_max !== d.precio_min
          ? `— ${money(d.precio_min)} a ${money(d.precio_max)} ${d.moneda ?? "MXN"}`
          : `— desde ${money(d.precio_min)} ${d.moneda ?? "MXN"}`
      );
    }
    if (d.recamaras_min != null) {
      partes.push(
        d.recamaras_max != null && d.recamaras_max !== d.recamaras_min
          ? `· ${d.recamaras_min}-${d.recamaras_max} rec`
          : `· ${d.recamaras_min} rec`
      );
    }
    if (d.enganche_pct != null) partes.push(`· enganche ${d.enganche_pct}%`);
    if (d.meses_opciones?.length) partes.push(`· financiamiento ${d.meses_opciones.join("/")} meses`);
    partes.push(`· ${d.unidades_publicadas} unid. publicadas`);
    return partes.join(" ");
  });
  return `Catálogo publicado en propyte.com (fuente oficial, puedes citar estos datos):\n${lines.join("\n")}`;
}
