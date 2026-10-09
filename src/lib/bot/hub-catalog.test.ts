import { describe, it, expect, vi, beforeEach } from "vitest";

const searchCatalog = vi.fn();
vi.mock("@/lib/hub/catalog", () => ({ searchCatalog: (...a: unknown[]) => searchCatalog(...a) }));

import { findMatchingDevelopments, catalogBrief } from "./hub-catalog";

beforeEach(() => searchCatalog.mockReset());

describe("findMatchingDevelopments", () => {
  it("agrupa unidades por desarrollo y conserva el rango de precio", async () => {
    searchCatalog.mockResolvedValue({
      data: [
        { developmentId: "d1", developmentName: "Nativa", zone: "Tulum", city: "Tulum",
          priceMxn: 3_000_000, bedrooms: 1, finEnganchePct: 20, finMesesOpciones: [12, 24] },
        { developmentId: "d1", developmentName: "Nativa", zone: "Tulum", city: "Tulum",
          priceMxn: 5_000_000, bedrooms: 2, finEnganchePct: 20, finMesesOpciones: [12, 24] },
        { developmentId: "d2", developmentName: "Turena", zone: "Mérida", city: "Mérida",
          priceMxn: 2_000_000, bedrooms: 2, finEnganchePct: null, finMesesOpciones: null },
      ],
      error: null,
    });
    const res = await findMatchingDevelopments({ budgetMax: 6_000_000 });
    expect(res.error).toBeNull();
    expect(res.data).toHaveLength(2);
    const nativa = res.data.find((d) => d.id === "d1")!;
    expect(nativa.precio_min).toBe(3_000_000);
    expect(nativa.precio_max).toBe(5_000_000);
    expect(nativa.unidades_publicadas).toBe(2);
    expect(nativa.enganche_pct).toBe(20);
  });

  it("propaga el error en vez de fingir catálogo vacío", async () => {
    searchCatalog.mockResolvedValue({ data: [], error: "No se pudo consultar el catálogo del Hub" });
    const res = await findMatchingDevelopments({});
    expect(res.data).toEqual([]);
    expect(res.error).toBeTruthy();
  });

  // Intención heredada del fix del 25-jul (pedido de Luis): un desarrollo sin unidades
  // publicadas NO se cita. Antes se lograba con un JOIN a Propyte_unidades; ahora sale por
  // construcción, porque agrupamos las unidades publicadas que devuelve searchCatalog.
  it("no cita desarrollos sin unidades publicadas", async () => {
    searchCatalog.mockResolvedValue({ data: [], error: null });
    const res = await findMatchingDevelopments({ budgetMax: 6_000_000 });
    expect(res.error).toBeNull();
    expect(res.data).toEqual([]);
  });

  // Intención heredada del 25-jul: el presupuesto y la zona tienen que llegar a la consulta,
  // no filtrarse después en JS sobre una ventana ya recortada.
  it("pasa presupuesto y zona a la capa de catálogo", async () => {
    searchCatalog.mockResolvedValue({ data: [], error: null });
    await findMatchingDevelopments({ budgetMin: 1_000_000, budgetMax: 6_000_000, zone: "Tulum" });
    expect(searchCatalog).toHaveBeenCalledWith(
      expect.objectContaining({ budgetMin: 1_000_000, budgetMax: 6_000_000, zone: "Tulum" })
    );
  });

  // Marca del agente (2026-10-09): un bot de marca solo ve los desarrollos de su marca.
  // Una lista vacía significa "esta marca no tiene desarrollos": no se consulta nada
  // (si se pasara vacía al SQL no filtraría y se filtraría el catálogo de otras marcas).
  it("developmentIds vacío → sin catálogo y sin consultar", async () => {
    const r = await findMatchingDevelopments({ developmentIds: [] });
    expect(r).toEqual({ data: [], error: null });
    expect(searchCatalog).not.toHaveBeenCalled();
  });

  it("developmentIds se pasa a searchCatalog", async () => {
    searchCatalog.mockResolvedValue({ data: [], error: null });
    await findMatchingDevelopments({ developmentIds: ["d1", "d2"], limit: 10 });
    expect(searchCatalog).toHaveBeenCalledWith(expect.objectContaining({ developmentIds: ["d1", "d2"] }));
  });

  it("sin developmentIds se pasa null a searchCatalog (todos los desarrollos)", async () => {
    searchCatalog.mockResolvedValue({ data: [], error: null });
    await findMatchingDevelopments({});
    expect(searchCatalog).toHaveBeenCalledWith(expect.objectContaining({ developmentIds: null }));
  });
});

describe("catalogBrief", () => {
  it("incluye enganche y plazos cuando existen", () => {
    const brief = catalogBrief([
      { id: "d1", nombre: "Nativa", zona: "Tulum", ciudad: "Tulum", precio_min: 3_000_000,
        precio_max: 5_000_000, moneda: "MXN", unidades_publicadas: 2, recamaras_min: 1,
        recamaras_max: 2, enganche_pct: 20, meses_opciones: [12, 24] },
    ]);
    expect(brief).toContain("Nativa");
    expect(brief).toContain("Tulum");
    expect(brief).toContain("20%");
    expect(brief).toContain("12");
  });

  it("devuelve cadena vacía sin desarrollos", () => {
    expect(catalogBrief([])).toBe("");
  });

  it("catalogBrief con encabezado propio", () => {
    const out = catalogBrief(
      [{ id: "d1", nombre: "Yaxnáh Caucel", zona: "Caucel", ciudad: "Mérida", precio_min: 2090000, precio_max: 2090000, moneda: "MXN", unidades_publicadas: 1, recamaras_min: 3, recamaras_max: 3, enganche_pct: null, meses_opciones: null }],
      "Catálogo oficial de Yaxnáh Caucel:"
    );
    expect(out.startsWith("Catálogo oficial de Yaxnáh Caucel:\n")).toBe(true);
  });

  it("catalogBrief sin encabezado conserva el texto de hoy", () => {
    const out = catalogBrief([{ id: "d1", nombre: "X", zona: null, ciudad: null, precio_min: null, precio_max: null, moneda: "MXN", unidades_publicadas: 1, recamaras_min: null, recamaras_max: null, enganche_pct: null, meses_opciones: null }]);
    expect(out.startsWith("Catálogo publicado en propyte.com (fuente oficial, puedes citar estos datos):\n")).toBe(true);
  });
});
