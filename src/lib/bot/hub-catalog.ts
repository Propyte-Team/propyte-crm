// HubCatalog — proyección read-only del catálogo del Hub (decisión Anexo B §K G.2).
// Mientras no exista la API del Hub (T5.1), lectura SQL directa al esquema
// real_estate_hub por la MISMA conexión Postgres. Esta interfaz aísla el swap a API.
import prisma from "@/lib/db";

export interface HubDevelopmentSummary {
  id: string;
  nombre: string;
  zona: string | null;
  precio_min: number | null;
  precio_max: number | null;
  moneda: string | null;
  status: string | null;
}

// Desarrollos publicados que encajan con el perfil (para data-gate del bot y matching).
// Defensivo: cualquier error (permisos/columnas) → lista vacía, nunca rompe al caller.
export async function findMatchingDevelopments(opts: {
  budgetMin?: number | null;
  budgetMax?: number | null;
  zone?: string | null;
  limit?: number;
}): Promise<HubDevelopmentSummary[]> {
  const limit = Math.min(opts.limit ?? 3, 10);
  try {
    const rows = await prisma.$queryRawUnsafe<HubDevelopmentSummary[]>(
      `SELECT d.id::text AS id,
              d.nombre_desarrollo AS nombre,
              d.zona AS zona,
              d.ext_precio_min_mxn::float8 AS precio_min,
              d.ext_precio_max_mxn::float8 AS precio_max,
              'MXN' AS moneda,
              d.pipeline_status AS status
         FROM real_estate_hub."Propyte_desarrollos" d
        WHERE d.pipeline_status = 'published'
          AND ($1::float8 IS NULL OR d.ext_precio_max_mxn >= $1)
          AND ($2::float8 IS NULL OR d.ext_precio_min_mxn <= $2)
          AND ($3::text IS NULL OR d.zona ILIKE '%' || $3 || '%')
        ORDER BY d.ext_precio_min_mxn ASC NULLS LAST
        LIMIT ${limit}`,
      opts.budgetMin ?? null,
      opts.budgetMax ?? null,
      opts.zone ?? null
    );
    return rows;
  } catch (err) {
    console.error("[hub-catalog] consulta falló (data-gate devuelve vacío):", err);
    return [];
  }
}

export function catalogBrief(devs: HubDevelopmentSummary[]): string {
  if (devs.length === 0) return "";
  const lines = devs.map((d) => {
    const precio =
      d.precio_min != null
        ? ` — desde $${Math.round(d.precio_min).toLocaleString("es-MX")} ${d.moneda ?? "MXN"}`
        : "";
    return `• ${d.nombre}${d.zona ? ` (${d.zona})` : ""}${precio}`;
  });
  return `Catálogo del Hub (fuente oficial, puedes citar estos datos):\n${lines.join("\n")}`;
}
