import { describe, it, expect } from "vitest";
import { generateShortlistToken } from "./token";
import { buildUnitSnapshot, nextSortOrder, shouldMarkOpened } from "./snapshot";
import type { HubUnit } from "@/lib/hub/types";

describe("generateShortlistToken", () => {
  it("genera tokens no vacíos y únicos", () => {
    const a = generateShortlistToken();
    const b = generateShortlistToken();
    expect(a.length).toBeGreaterThan(16);
    expect(a).not.toEqual(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/); // base64url
  });
});

describe("buildUnitSnapshot", () => {
  it("congela los campos relevantes de la unidad del Hub", () => {
    const unit: HubUnit = {
      id: "u1", developmentId: "d1", numero: "101", titulo: "PH Azul",
      tipo: "Departamento", tipologia: "2R", recamaras: 2, banos: 2,
      m2Construccion: 95, m2Total: 110, precioMxn: 5200000, precioUsd: null,
      moneda: "MXN", status: "DISPONIBLE",
    };
    const snap = buildUnitSnapshot(unit);
    expect(snap.hubUnitId).toBe("u1");
    expect(snap.titulo).toBe("PH Azul");
    expect(snap.precioMxn).toBe(5200000);
    expect(snap.moneda).toBe("MXN");
  });
});

describe("nextSortOrder", () => {
  it("devuelve 0 para lista vacía y max+1 si hay items", () => {
    expect(nextSortOrder([])).toBe(0);
    expect(nextSortOrder([{ sortOrder: 0 }, { sortOrder: 3 }])).toBe(4);
  });
});

describe("shouldMarkOpened", () => {
  it("true solo si openedAt es null", () => {
    expect(shouldMarkOpened({ openedAt: null })).toBe(true);
    expect(shouldMarkOpened({ openedAt: new Date() })).toBe(false);
  });
});
