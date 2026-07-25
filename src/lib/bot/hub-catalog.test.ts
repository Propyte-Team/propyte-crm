import { describe, it, expect, vi, beforeEach } from "vitest";

// BUG 2026-07-25 (broker Marcos Albores): el bot citó "Residencial Sense Cancún",
// un desarrollo con ext_publicado=false. La consulta filtraba por
// pipeline_status='Publicado' — columna STALE desincronizada de la canónica (mismo
// hallazgo que motivó el gate outbound del Hub el 15-jul). La verdad de "lo que
// Propyte publica" es ext_publicado; y el Hub tiene filas duplicadas por nombre.

const queryRawUnsafe = vi.fn();
vi.mock("@/lib/db", () => ({
  default: { $queryRawUnsafe: (...a: unknown[]) => queryRawUnsafe(...a) },
}));

import { findMatchingDevelopments, catalogBrief } from "./hub-catalog";

beforeEach(() => {
  queryRawUnsafe.mockReset();
  queryRawUnsafe.mockResolvedValue([]);
});

describe("findMatchingDevelopments — solo inventario con unidades dadas de alta en el sitio", () => {
  // Pedido Luis 2026-07-25: un desarrollo es citable SOLO si tiene unidades publicadas
  // en el sitio web (Propyte_unidades.ext_publicado) — no basta el flag del desarrollo.
  // Los precios salen de esas unidades reales (no del ext_precio_min stale del dev).
  it("ancla el filtro en unidades publicadas (ext_publicado en unidad Y desarrollo)", async () => {
    await findMatchingDevelopments({});
    const sql = queryRawUnsafe.mock.calls[0][0] as string;
    expect(sql).toContain('"Propyte_unidades"');
    expect(sql).toContain("u.ext_publicado = true");
    expect(sql).toContain("d.ext_publicado = true");
    expect(sql).toContain("u.deleted_at IS NULL");
    expect(sql).toContain("d.deleted_at IS NULL");
    expect(sql).not.toContain("pipeline_status::text = 'Publicado'");
  });

  it("precios derivados de las unidades web (MIN/MAX de precio_mxn), agrupado por desarrollo", async () => {
    await findMatchingDevelopments({});
    const sql = queryRawUnsafe.mock.calls[0][0] as string;
    expect(sql).toContain("MIN(u.precio_mxn)");
    expect(sql).toContain("MAX(u.precio_mxn)");
    expect(sql).toContain("GROUP BY d.id");
  });

  it("pasa presupuesto/zona como parámetros", async () => {
    await findMatchingDevelopments({ budgetMin: 1_000_000, budgetMax: 3_000_000, zone: "Cancún" });
    expect(queryRawUnsafe.mock.calls[0].slice(1)).toEqual([1_000_000, 3_000_000, "Cancún"]);
  });

  it("error de consulta → lista vacía (data-gate: sin catálogo no se citan precios)", async () => {
    queryRawUnsafe.mockRejectedValue(new Error("permission denied"));
    expect(await findMatchingDevelopments({})).toEqual([]);
  });
});

describe("catalogBrief", () => {
  it("sin desarrollos → cadena vacía (el prompt instruye a no citar precios)", () => {
    expect(catalogBrief([])).toBe("");
  });
});
