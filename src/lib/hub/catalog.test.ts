import { describe, it, expect, vi, beforeEach } from "vitest";

const queryRaw = vi.fn().mockResolvedValue([]);
vi.mock("@/lib/db", () => ({
  default: { $queryRawUnsafe: (...a: unknown[]) => queryRaw(...a) },
}));

import {
  PUBLIC_GATE,
  listPublishedDevelopments,
  getPublishedDevelopment,
  listPublishedUnits,
  getPublishedUnit,
  searchCatalog,
} from "./catalog";

/** SQL de la última llamada a $queryRawUnsafe. */
function lastSql(): string {
  return String(queryRaw.mock.calls[queryRaw.mock.calls.length - 1][0]);
}

beforeEach(() => {
  queryRaw.mockClear();
  queryRaw.mockResolvedValue([]);
});

describe("PUBLIC_GATE", () => {
  it("es el mismo gate que usa propyte.com", () => {
    expect(PUBLIC_GATE).toContain("approved_at IS NOT NULL");
    expect(PUBLIC_GATE).toContain("deleted_at IS NULL");
  });
});

describe("gate aplicado en toda lectura", () => {
  // Nota: se ancla en `WHERE ${PUBLIC_GATE}` (no un simple .toContain(PUBLIC_GATE)) porque
  // DEV_LIST_COLS trae una subquery correlacionada que YA incluye el gate para contar
  // "publishedUnits" con el mismo criterio. Un .toContain plano seguía viendo esa copia
  // aunque el WHERE principal se mutara a `1=1` — falso verde detectado en el guard del step 6.
  it("listPublishedDevelopments filtra por el gate", async () => {
    await listPublishedDevelopments();
    expect(lastSql()).toContain(`WHERE ${PUBLIC_GATE}`);
  });

  it("getPublishedDevelopment filtra por el gate", async () => {
    await getPublishedDevelopment("dev-1");
    expect(lastSql()).toContain(`WHERE ${PUBLIC_GATE}`);
  });

  it("listPublishedUnits filtra por el gate", async () => {
    await listPublishedUnits({ developmentId: "dev-1" });
    expect(lastSql()).toContain(`WHERE ${PUBLIC_GATE}`);
  });

  it("getPublishedUnit filtra por el gate", async () => {
    await getPublishedUnit("unit-1");
    expect(lastSql()).toContain(`WHERE ${PUBLIC_GATE}`);
  });

  it("nunca lee de Propyte_desarrollos ni usa pipeline_status", async () => {
    await listPublishedDevelopments();
    expect(lastSql()).toContain("v_developments");
    expect(lastSql()).not.toContain("pipeline_status");
    expect(lastSql()).not.toContain("Propyte_desarrollos");
  });
});

describe("no expone columnas internas", () => {
  it("no selecciona metadatos de SEO ni de scraping", async () => {
    await listPublishedDevelopments();
    const sql = lastSql();
    for (const col of ["meta_title", "meta_description", "detection_source", "source_url", "keywords"]) {
      expect(sql).not.toContain(col);
    }
  });

  it("nunca usa SELECT *", async () => {
    await listPublishedDevelopments();
    expect(lastSql()).not.toMatch(/select\s+\*/i);
  });

  it("listPublishedUnits tampoco expone columnas internas ni SELECT *", async () => {
    await listPublishedUnits({ developmentId: "dev-1" });
    const sql = lastSql();
    for (const col of ["meta_title", "meta_description", "detection_source", "source_url", "keywords"]) {
      expect(sql).not.toContain(col);
    }
    expect(sql).not.toMatch(/select\s+\*/i);
  });
});

describe("manejo de errores", () => {
  it("distingue fallo de vacío legítimo", async () => {
    queryRaw.mockRejectedValueOnce(new Error("connection refused"));
    const res = await listPublishedDevelopments();
    expect(res.data).toEqual([]);
    expect(res.error).toBeTruthy();
  });

  it("vacío legítimo no reporta error", async () => {
    const res = await listPublishedDevelopments();
    expect(res.data).toEqual([]);
    expect(res.error).toBeNull();
  });

  it("getPublishedDevelopment devuelve null sin error cuando no existe", async () => {
    const res = await getPublishedDevelopment("no-existe");
    expect(res.data).toBeNull();
    expect(res.error).toBeNull();
  });
});

describe("clampLimit — LIMIT saneado antes de interpolar", () => {
  it("un limit inválido (NaN) cae al default en vez de romper el SQL", async () => {
    await listPublishedDevelopments({ limit: NaN });
    expect(lastSql()).toMatch(/LIMIT \d+/);
    expect(lastSql()).not.toMatch(/LIMIT NaN/);
  });

  it("topa el límite al máximo: pedir 9999 produce LIMIT 500", async () => {
    await listPublishedDevelopments({ limit: 9999 });
    expect(lastSql()).toContain("LIMIT 500");
  });

  it("limit 0 no es positivo: cae al default (200), no a LIMIT 1", async () => {
    await listPublishedDevelopments({ limit: 0 });
    expect(lastSql()).toContain("LIMIT 200");
  });

  it("limit negativo cae al default, no a LIMIT 1", async () => {
    await listPublishedDevelopments({ limit: -100 });
    expect(lastSql()).toContain("LIMIT 200");
  });

  it("limit fraccionario se trunca a entero", async () => {
    await listPublishedDevelopments({ limit: 12.7 });
    expect(lastSql()).toContain("LIMIT 12");
  });
});

describe("searchCatalog (agente IA)", () => {
  it("aplica el gate y devuelve unidades con su desarrollo", async () => {
    queryRaw.mockResolvedValueOnce([
      { id: "u1", developmentName: "Nativa", priceMxn: 4_000_000, bedrooms: 2 },
    ]);
    const res = await searchCatalog({ budgetMax: 5_000_000, bedrooms: 2 });
    expect(lastSql()).toContain(PUBLIC_GATE);
    expect(res.error).toBeNull();
    expect(res.data[0].developmentName).toBe("Nativa");
  });

  it("topa el límite a 25 aunque pidan más", async () => {
    await searchCatalog({ limit: 500 });
    expect(lastSql()).toContain("LIMIT 25");
  });

  it("ante fallo devuelve error, no lista vacía silenciosa", async () => {
    queryRaw.mockRejectedValueOnce(new Error("timeout"));
    const res = await searchCatalog({});
    expect(res.data).toEqual([]);
    expect(res.error).toBeTruthy();
  });
});
