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

describe("findMatchingDevelopments — solo inventario publicado", () => {
  it("filtra por ext_publicado + soft-delete, NO por pipeline_status stale", async () => {
    await findMatchingDevelopments({});
    const sql = queryRawUnsafe.mock.calls[0][0] as string;
    expect(sql).toContain("ext_publicado = true");
    expect(sql).toContain("deleted_at IS NULL");
    expect(sql).not.toContain("pipeline_status::text = 'Publicado'");
  });

  it("dedup por nombre de desarrollo (el Hub tiene filas duplicadas)", async () => {
    await findMatchingDevelopments({});
    const sql = queryRawUnsafe.mock.calls[0][0] as string;
    expect(sql).toContain("DISTINCT ON");
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
