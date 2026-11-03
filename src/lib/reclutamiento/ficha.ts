// Ficha de la vacante que ve el agente de reclutamiento: la base (SystemConfig o FICHA_DEFAULT)
// más oficinas y desarrollos del Hub. Texto plano de líneas cortas, sin precios. Los exclusivos
// van con nombre (producto propio); el co-broker solo se cuenta por ciudad para que el bot no
// «venda» desarrollos ajenos ni invente tipos (prueba 2026-11-03: Ancestral y Gran Coralia).
import type { DesarrolloReclutamiento } from "@/lib/hub/reclutamiento-inventario";

/** Textos oficiales (decisión de Luis, 2026-11-03). Mérida solo tiene la oficina de Yaxnáh Caucel. */
export const OFICINAS_FICHA =
  "Oficinas: Playa del Carmen, Quinta Avenida esquina con calle 40 (ubicación privilegiada, en plena Quinta).\n" +
  "Mérida: oficina de ventas de Yaxnáh Caucel, en Ciudad Caucel.";

const PLURAL: Record<string, string> = {
  terreno: "terrenos",
  casa: "casas",
  departamento: "departamentos",
  villa: "villas",
  penthouse: "penthouses",
  local: "locales",
};

const SIN_CIUDAD = "otras zonas";

function tipoPlural(tipo: string): string {
  const t = tipo.trim().toLowerCase();
  return PLURAL[t] ?? (t.endsWith("s") ? t : `${t}s`);
}

/** «a», «a y b», «a, b y c». */
function conY(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}

function lineaExclusivos(devs: DesarrolloReclutamiento[]): string | null {
  if (devs.length === 0) return null;
  const partes = devs.map((d) => {
    const detalle = [conY(d.tipos.map(tipoPlural)), d.ciudad?.trim() || ""].filter(Boolean).join(", ");
    return detalle ? `${d.nombre} (${detalle})` : d.nombre;
  });
  return `Desarrollos exclusivos de Propyte (producto propio): ${partes.join("; ")}.`;
}

function lineaCoBroker(devs: DesarrolloReclutamiento[]): string | null {
  if (devs.length === 0) return null;
  const porCiudad = new Map<string, { n: number; tipos: Map<string, number> }>();
  for (const d of devs) {
    const ciudad = d.ciudad?.trim() || SIN_CIUDAD;
    const g = porCiudad.get(ciudad) ?? { n: 0, tipos: new Map() };
    g.n += 1;
    for (const t of new Set(d.tipos.map(tipoPlural))) g.tipos.set(t, (g.tipos.get(t) ?? 0) + 1);
    porCiudad.set(ciudad, g);
  }
  const ciudades = [...porCiudad.entries()].sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0], "es"));
  const partes = ciudades.map(([ciudad, g], i) => {
    // Tipos del más al menos frecuente; a igual frecuencia, orden de aparición.
    const tipos = [...g.tipos.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
    const cuenta = i === 0 ? `${g.n} ${g.n === 1 ? "desarrollo" : "desarrollos"}` : String(g.n);
    return tipos.length ? `${ciudad}: ${cuenta} (${tipos.join(", ")})` : `${ciudad}: ${cuenta}`;
  });
  return `Además comercializamos inventario de otros desarrolladores (co-broker): ${partes.join("; ")}.`;
}

/**
 * Base + oficinas + (si hay datos) exclusivos con nombre y co-broker contado por ciudad, ciudades
 * ordenadas por número de desarrollos desc. Los REFERIDOS no son inventario que vendamos: no salen.
 * Con `devs` vacío (Hub caído o sin datos) solo base + oficinas: la base ya habla del inventario.
 */
export function construirFicha(base: string, devs: DesarrolloReclutamiento[]): string {
  const exclusivos = lineaExclusivos(devs.filter((d) => d.relacion === "EXCLUSIVO"));
  const coBroker = lineaCoBroker(devs.filter((d) => d.relacion === "CO_BROKER"));
  return [base.trim(), OFICINAS_FICHA, exclusivos, coBroker].filter((l): l is string => !!l).join("\n");
}
