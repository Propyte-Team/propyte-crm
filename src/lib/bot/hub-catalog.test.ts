import { describe, it, expect, vi, beforeEach } from "vitest";

const searchCatalog = vi.fn();
vi.mock("@/lib/hub/catalog", () => ({ searchCatalog: (...a: unknown[]) => searchCatalog(...a) }));

import { findMatchingDevelopments, catalogBrief } from "./hub-catalog";

// Con llaves: `() => spy.mockReset()` devuelve el propio mock y vitest lo invoca como hook de
// limpieza tras cada prueba (sin argumentos), lo que rompe un mockImplementation que lee `f.limit`.
beforeEach(() => {
  searchCatalog.mockReset();
});

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

  // Marca del agente (2026-10-09): el catálogo de una marca no se recorta a las 25 unidades más
  // baratas. Con Yaxnáh (~51 unidades) las 22 Kannah (3 rec, las más caras) quedaban fuera y el
  // resumen decía "$1,433,000 a $1,800,000 · 2 rec": el agente negaba que hubiera casas de 3 rec.
  // El mock imita a searchCatalog: ordena por precio ascendente y corta en `limit`.
  describe("catálogo completo de una marca", () => {
    const unidadesYaxnah = Array.from({ length: 30 }, (_, i) => ({
      developmentId: "yaxnah",
      developmentName: "Yaxnáh Caucel",
      zone: "Caucel",
      city: "Mérida",
      currency: "MXN",
      // 8 casas de 2 rec (1.4M-1.75M) y 22 de 3 rec (1.9M-2.09M, las más caras)
      priceMxn: i === 29 ? 2_090_000 : i < 8 ? 1_400_000 + i * 50_000 : 1_900_000 + (i - 8) * 9_048,
      bedrooms: i < 8 ? 2 : 3,
      finEnganchePct: null,
      finMesesOpciones: null,
    }));

    function searchCatalogQueRecorta() {
      searchCatalog.mockImplementation(async (f: { limit?: number }) => ({
        data: [...unidadesYaxnah].sort((a, b) => a.priceMxn - b.priceMxn).slice(0, f.limit ?? 5),
        error: null,
      }));
    }

    it("con developmentIds pide limit 500 y el resumen cubre todo el rango de precio y recámaras", async () => {
      searchCatalogQueRecorta();
      const res = await findMatchingDevelopments({ developmentIds: ["yaxnah"] });
      expect(searchCatalog).toHaveBeenCalledWith(expect.objectContaining({ limit: 500 }));
      expect(res.error).toBeNull();
      expect(res.data).toHaveLength(1);
      expect(res.data[0].unidades_publicadas).toBe(30);
      expect(res.data[0].precio_max).toBe(2_090_000);
      expect(res.data[0].recamaras_max).toBe(3);
    });

    it("sin developmentIds se sigue pidiendo limit 25", async () => {
      searchCatalogQueRecorta();
      await findMatchingDevelopments({});
      expect(searchCatalog).toHaveBeenCalledWith(expect.objectContaining({ limit: 25 }));
    });
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
