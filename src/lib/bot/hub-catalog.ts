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

// Desarrollos citables por el bot = con UNIDADES dadas de alta en el sitio web
// (pedido Luis 2026-07-25): no basta el flag del desarrollo — si no tiene unidades
// publicadas (Propyte_unidades.ext_publicado) no se ofrece. Los precios salen de esas
// unidades reales (MIN/MAX de precio_mxn), no del ext_precio_min stale del desarrollo.
// El presupuesto matchea si el rango de precios de sus unidades web se traslapa con él.
// (Antes: pipeline_status='Publicado', columna stale — citó un dev no publicado, 25-jul.)
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
              MIN(u.precio_mxn)::float8 AS precio_min,
              MAX(u.precio_mxn)::float8 AS precio_max,
              'MXN' AS moneda,
              d.zoho_pipeline_status AS status
         FROM real_estate_hub."Propyte_desarrollos" d
         JOIN real_estate_hub."Propyte_unidades" u ON u.id_desarrollo = d.id
        WHERE d.ext_publicado = true
          AND d.deleted_at IS NULL
          AND u.ext_publicado = true
          AND u.deleted_at IS NULL
          AND ($3::text IS NULL OR COALESCE(u.zona, d.zona) ILIKE '%' || $3 || '%')
        GROUP BY d.id, d.nombre_desarrollo, d.zona, d.zoho_pipeline_status
       HAVING ($1::float8 IS NULL OR MAX(u.precio_mxn) >= $1)
          AND ($2::float8 IS NULL OR MIN(u.precio_mxn) <= $2)
        ORDER BY MIN(u.precio_mxn) ASC NULLS LAST
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
