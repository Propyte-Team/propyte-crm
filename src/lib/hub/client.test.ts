import { describe, it, expect, vi, beforeEach } from "vitest";

const queryRaw = vi.fn().mockResolvedValue([]);
vi.mock("@/lib/db", () => ({
  default: { $queryRawUnsafe: (...a: unknown[]) => queryRaw(...a) },
}));

import { PUBLIC_GATE } from "./catalog";
import { listHubDevelopments, getHubDevelopment, listHubUnits, getHubUnit } from "./client";

function lastSql(): string {
  return String(queryRaw.mock.calls[queryRaw.mock.calls.length - 1][0]);
}

beforeEach(() => {
  queryRaw.mockClear();
  queryRaw.mockResolvedValue([]);
});

describe("client.ts usa el mismo gate que el sitio", () => {
  it("listHubDevelopments ya no filtra por pipeline_status", async () => {
    await listHubDevelopments();
    expect(lastSql()).toContain(PUBLIC_GATE);
    expect(lastSql()).not.toContain("pipeline_status");
  });

  it("listHubUnits usa el gate público", async () => {
    await listHubUnits({});
    expect(lastSql()).toContain(PUBLIC_GATE);
  });
});

describe("listHubUnits delega onlyAvailable en SQL, no filtra otra vez en JS", () => {
  // Regresión: onlyAvailable se filtraba aquí en JS DESPUÉS de que la SQL ya hubiera
  // aplicado el LIMIT sobre filas ordenadas por unit_number — las disponibles fuera de
  // esa ventana se perdían en silencio. Ahora el filtro vive en SQL (catalog.ts, antes
  // del LIMIT) y client.ts confía en lo que la query ya filtró, sin recortar de nuevo.
  it("pasa onlyAvailable a listPublishedUnits en vez de filtrar el resultado en JS", async () => {
    await listHubUnits({ onlyAvailable: true, limit: 5 });
    const params = queryRaw.mock.calls[queryRaw.mock.calls.length - 1].slice(1);
    expect(params[6]).toBe(true); // 7º parámetro posicional = onlyAvailable, activado
  });

  it("no vuelve a filtrar en JS: confía en lo que la SQL ya devolvió", async () => {
    // Si client.ts todavía filtrara en JS, esta fila con status "Vendida" se
    // descartaría. Como la responsabilidad ya es de SQL, debe pasar intacta.
    queryRaw.mockResolvedValueOnce([
      { id: "u1", developmentId: "d1", unitNumber: "101", status: "Vendida",
        bedrooms: 1, bathrooms: 1, priceMxn: 2_000_000, currency: "MXN" },
    ]);
    const units = await listHubUnits({ onlyAvailable: true });
    expect(units).toHaveLength(1);
    expect(units[0].status).toBe("Vendida");
  });
});

describe("firmas legadas intactas", () => {
  it("listHubDevelopments devuelve un array, no un CatalogResult", async () => {
    const res = await listHubDevelopments();
    expect(Array.isArray(res)).toBe(true);
  });

  it("ante fallo devuelve [] para no romper a los callers", async () => {
    queryRaw.mockRejectedValueOnce(new Error("db caída"));
    const res = await listHubDevelopments();
    expect(res).toEqual([]);
  });

  it("getHubDevelopment devuelve null cuando no hay fila", async () => {
    expect(await getHubDevelopment("x")).toBeNull();
  });

  it("getHubUnit mapea al shape legado HubUnit", async () => {
    queryRaw.mockResolvedValueOnce([
      { id: "u1", developmentId: "d1", unitNumber: "101", title: "PH", unitType: "Depa",
        typology: "2R", bedrooms: 2, bathrooms: 2, builtAreaM2: 90, areaM2: 100,
        priceMxn: 4_000_000, priceUsd: null, currency: "MXN", status: "disponible" },
    ]);
    const u = await getHubUnit("u1");
    expect(u).toMatchObject({
      id: "u1", developmentId: "d1", numero: "101", recamaras: 2,
      m2Construccion: 90, precioMxn: 4_000_000, moneda: "MXN",
    });
  });

  it("getHubDevelopment (toHubDevelopment) mapea cada campo al shape legado HubDevelopment", async () => {
    queryRaw.mockResolvedValueOnce([
      { id: "d1", name: "Nativa Tulum", zone: "La Veleta", city: "Tulum", stage: "Preventa",
        priceMinMxn: 1_500_000, priceMaxMxn: 3_200_000, currency: "MXN" },
    ]);
    const d = await getHubDevelopment("d1");
    expect(d).toMatchObject({
      id: "d1",
      nombre: "Nativa Tulum",
      zona: "La Veleta",
      plaza: "Tulum",
      status: "Preventa",
      precioMin: 1_500_000,
      precioMax: 3_200_000,
      moneda: "MXN",
    });
  });
});

describe("getHubUnit/getHubDevelopment NO llevan gate (regresión: resolución operativa)", () => {
  // Antes de esta corrección, getHubUnit/getHubDevelopment delegaban en
  // getPublishedUnit/getPublishedDevelopment (con PUBLIC_GATE). De v_units con 1,479
  // unidades, solo 56 pasan el gate — cotizar o dar seguimiento a la unidad apartada o
  // vendida más común del embudo fallaba en silencio. Estas pruebas fijan que el lookup
  // por ID resuelve SIEMPRE, sin importar si la unidad/desarrollo está publicado.

  it("getHubUnit no filtra por PUBLIC_GATE en su SQL", async () => {
    await getHubUnit("u1");
    expect(lastSql()).not.toContain(PUBLIC_GATE);
  });

  it("getHubDevelopment no gatea su WHERE principal", async () => {
    // DEV_LIST_COLS trae PUBLIC_GATE en una subquery de conteo (publishedUnits) que es
    // independiente del WHERE principal — por eso se ancla en `WHERE ${PUBLIC_GATE}`.
    await getHubDevelopment("d1");
    expect(lastSql()).not.toContain(`WHERE ${PUBLIC_GATE}`);
  });

  it("getHubUnit resuelve una unidad que NO pasaría el gate (ej. vendida, sin approved_at)", async () => {
    queryRaw.mockResolvedValueOnce([
      { id: "u-vendida", developmentId: "d1", unitNumber: "205", title: "PH Vendido",
        unitType: "Depa", typology: "2R", bedrooms: 2, bathrooms: 2, builtAreaM2: 90,
        areaM2: 100, priceMxn: 4_000_000, priceUsd: null, currency: "MXN", status: "Vendida" },
    ]);
    const u = await getHubUnit("u-vendida");
    expect(u).not.toBeNull();
    expect(u).toMatchObject({ id: "u-vendida", status: "Vendida" });
  });

  it("getHubDevelopment resuelve un desarrollo que NO pasaría el gate (ej. no aprobado)", async () => {
    queryRaw.mockResolvedValueOnce([
      { id: "d-no-publicado", name: "Interno Sin Aprobar", zone: "Zona X", city: "Tulum",
        stage: "Preventa", priceMinMxn: 1_000_000, priceMaxMxn: null, currency: "MXN" },
    ]);
    const d = await getHubDevelopment("d-no-publicado");
    expect(d).not.toBeNull();
    expect(d).toMatchObject({ id: "d-no-publicado", nombre: "Interno Sin Aprobar" });
  });
});
