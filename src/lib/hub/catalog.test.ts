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
