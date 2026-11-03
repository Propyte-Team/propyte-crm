// Inventario del Hub para la FICHA del bot de reclutamiento (decisión de Luis, 2026-11-03).
//
// El agente de reclutamiento recibía el catálogo de VENTAS (findMatchingDevelopments, filtrado
// por presupuesto/zona del contacto) y así habló de Ancestral y Gran Coralia como departamentos.
// Aquí se lee lo que un candidato necesita saber: qué desarrollos son producto propio (exclusivos)
// y cuánto inventario de co-broker hay por ciudad. Sin precios, sin unidades.
//
// Misma conexión y mismo gate público que src/lib/hub/catalog.ts (PUBLIC_GATE se importa, no se
// reescribe). `d.name` es el nombre real: NO `publication_title`.
import prisma from "@/lib/db";
import { PUBLIC_GATE } from "./catalog";

export type RelacionDesarrollo = "EXCLUSIVO" | "CO_BROKER" | "REFERIDOS";

export interface DesarrolloReclutamiento {
  nombre: string;
  ciudad: string | null;
  relacion: RelacionDesarrollo;
  /** Tipos de propiedad tal como vienen del Hub (Departamento, Casa, Terreno, Villa, Penthouse, Local). */
  tipos: string[];
  disponibles: number | null;
}

interface Fila {
  nombre: string;
  ciudad: string | null;
  relacion: string | null;
  tipos: string[] | null;
  disponibles: number | null;
}

const SQL = `
  SELECT
    d.name::text              AS nombre,
    d.city::text              AS ciudad,
    d.crm_relationship::text  AS relacion,
    d.property_types          AS tipos,
    d.available_units::int    AS disponibles
  FROM real_estate_hub.v_developments d
  WHERE ${PUBLIC_GATE}
  ORDER BY d.name
`;

/** 'Exclusivo' → EXCLUSIVO, 'Referidos' → REFERIDOS, 'Co-broker'/'cobroker'/NULL/otro → CO_BROKER. */
export function normalizarRelacion(raw: string | null | undefined): RelacionDesarrollo {
  const r = (raw ?? "").trim().toLowerCase();
  if (r.startsWith("exclus")) return "EXCLUSIVO";
  if (r.startsWith("refer")) return "REFERIDOS";
  return "CO_BROKER";
}

const TTL_MS = 10 * 60 * 1000;
let cache: { en: number; data: DesarrolloReclutamiento[] } | null = null;

/** Solo para tests. */
export function _limpiarCacheInventarioReclutamiento(): void {
  cache = null;
}

/**
 * Desarrollos publicados con su relación normalizada. Cache en memoria de 10 min (la ficha se
 * arma en cada turno del bot y el inventario cambia poco). Nunca lanza: error → [] sin cachear.
 */
export async function desarrollosParaReclutamiento(): Promise<DesarrolloReclutamiento[]> {
  const ahora = Date.now();
  if (cache && ahora - cache.en < TTL_MS) return cache.data;
  try {
    const filas = await prisma.$queryRawUnsafe<Fila[]>(SQL);
    const data = filas.map((f) => ({
      nombre: f.nombre,
      ciudad: f.ciudad ?? null,
      relacion: normalizarRelacion(f.relacion),
      tipos: Array.isArray(f.tipos) ? f.tipos.filter((t): t is string => typeof t === "string" && t.trim() !== "") : [],
      disponibles: typeof f.disponibles === "number" ? f.disponibles : null,
    }));
    cache = { en: ahora, data };
    return data;
  } catch (err) {
    console.warn("[reclutamiento] inventario del Hub no disponible", err);
    return [];
  }
}
