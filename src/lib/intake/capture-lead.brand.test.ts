// Entrada de leads por marca (2026-10-09, spec marcas-agente §2.3 y §5):
//  - un contacto NUEVO que entra por una cuenta de marca NO predeterminada toma la plaza
//    predeterminada de esa marca (gana sobre las palabras clave de resolveTargetPlaza);
//  - toda entrada por una cuenta registra la atribución contacto↔marca con attachBrand,
//    FUERA de la transacción del candado de intake;
//  - un contacto que ya existía NO cambia de plaza ni de asesor por llegar por otra marca.
import { describe, it, expect, vi, beforeEach } from "vitest";

const findFirst = vi.fn();
const create = vi.fn();
const update = vi.fn();
const connectorFindUnique = vi.fn();
const attachBrand = vi.fn();
const getDefaultBrandId = vi.fn();

// Estado del candado simulado: attachBrand debe correr con el candado ya cerrado.
const lock = { open: false, openAtAttach: [] as boolean[] };

vi.mock("@/lib/db", () => ({
  default: {
    leadConnector: { findUnique: (...a: unknown[]) => connectorFindUnique(...a) },
    contact: {
      findFirst: (...a: unknown[]) => findFirst(...a),
      create: (...a: unknown[]) => create(...a),
      update: (...a: unknown[]) => update(...a),
    },
    adAttribution: { findUnique: vi.fn(async () => null), create: vi.fn(async () => ({})) },
    activity: { create: vi.fn(async () => ({})) },
  },
}));
vi.mock("@/lib/workflows/routing", () => ({ autoRouteLead: vi.fn(async () => "u-ruteo") }));
vi.mock("@/lib/workflows/events", () => ({ emitEvent: vi.fn() }));
vi.mock("@/lib/brands/attach", () => ({
  attachBrand: (...a: unknown[]) => {
    lock.openAtAttach.push(lock.open);
    return attachBrand(...a);
  },
}));
vi.mock("@/lib/brands/resolve", () => ({
  getDefaultBrandId: (...a: unknown[]) => getDefaultBrandId(...a),
}));

// #844: captureLead serializa búsqueda + alta con un advisory lock de Postgres
// (intake-lock.ts). Aquí no hay Postgres: el candado pasa de largo y entrega el mismo
// db simulado como "transacción", marcando cuándo está abierto.
vi.mock("@/lib/intake/intake-lock", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/intake/intake-lock")>();
  const { default: db } = await import("@/lib/db");
  return {
    ...actual,
    withIntakeLock: async (_key: string | null, fn: (d: unknown) => Promise<unknown>) => {
      lock.open = true;
      try {
        return await fn(db);
      } finally {
        lock.open = false;
      }
    },
  };
});

import { captureLead } from "./capture-lead";

const CUENTA_YAX = {
  name: "IG Cuenta X",
  brandId: "b-yax",
  brand: { isDefault: false, defaultPlaza: "MERIDA", deletedAt: null },
};

beforeEach(() => {
  [findFirst, create, update, connectorFindUnique, attachBrand, getDefaultBrandId].forEach((m) => m.mockReset());
  lock.open = false;
  lock.openAtAttach = [];
  update.mockResolvedValue({});
  attachBrand.mockResolvedValue(undefined);
  create.mockResolvedValue({ id: "c-new", assignedToId: null });
});

describe("captureLead — plaza por marca de la cuenta", () => {
  it("cuenta de marca no predeterminada con defaultPlaza MERIDA → contacto nuevo en MERIDA aunque las señales digan nativa", async () => {
    findFirst.mockResolvedValue(null);
    connectorFindUnique.mockResolvedValue(CUENTA_YAX);
    await captureLead(
      { source: "INSTAGRAM", firstName: "Ana", email: "ana@x.com", campaignName: "Nativa Tulum - Preventa" },
      { connectorId: "conn-yax", skipRouting: true },
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ targetPlaza: "MERIDA" }) }),
    );
    expect(attachBrand).toHaveBeenCalledTimes(1);
    expect(attachBrand).toHaveBeenCalledWith({
      contactId: "c-new",
      brandId: "b-yax",
      connectorId: "conn-yax",
      contactIsNew: true,
    });
  });

  it("la lectura de la cuenta pide la marca (isDefault, defaultPlaza, deletedAt) y su id", async () => {
    findFirst.mockResolvedValue(null);
    connectorFindUnique.mockResolvedValue(CUENTA_YAX);
    await captureLead(
      { source: "INSTAGRAM", firstName: "Ana", email: "ana@x.com" },
      { connectorId: "conn-yax", skipRouting: true },
    );
    expect(connectorFindUnique).toHaveBeenCalledWith({
      where: { id: "conn-yax" },
      select: {
        name: true,
        brandId: true,
        brand: { select: { isDefault: true, defaultPlaza: true, deletedAt: true } },
      },
    });
  });

  it("cuenta de marca no predeterminada SIN defaultPlaza → la plaza sale de resolveTargetPlaza(señales)", async () => {
    findFirst.mockResolvedValue(null);
    connectorFindUnique.mockResolvedValue({
      name: "IG Cuenta Y",
      brandId: "b-otra",
      brand: { isDefault: false, defaultPlaza: null, deletedAt: null },
    });
    await captureLead(
      { source: "INSTAGRAM", firstName: "Ana", email: "ana@x.com", campaignName: "Nativa Tulum - Preventa" },
      { connectorId: "conn-otra", skipRouting: true },
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ targetPlaza: "TULUM" }) }),
    );
    expect(attachBrand).toHaveBeenCalledWith({
      contactId: "c-new",
      brandId: "b-otra",
      connectorId: "conn-otra",
      contactIsNew: true,
    });
  });

  it("marca predeterminada con defaultPlaza → NO la usa: la plaza sale de las señales, como hoy", async () => {
    findFirst.mockResolvedValue(null);
    connectorFindUnique.mockResolvedValue({
      name: "WhatsApp Propyte",
      brandId: "b-def",
      brand: { isDefault: true, defaultPlaza: "MERIDA", deletedAt: null },
    });
    await captureLead(
      { source: "FACEBOOK_ADS", firstName: "Ana", email: "ana@x.com", campaignName: "Campaña Playa" },
      { connectorId: "conn-def", skipRouting: true },
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ targetPlaza: "PDC" }) }),
    );
  });

  it("marca borrada (deletedAt) con defaultPlaza → NO la usa: la plaza sale de las señales", async () => {
    findFirst.mockResolvedValue(null);
    connectorFindUnique.mockResolvedValue({
      name: "IG Vieja",
      brandId: "b-borrada",
      brand: { isDefault: false, defaultPlaza: "MERIDA", deletedAt: new Date("2026-09-01") },
    });
    await captureLead(
      { source: "INSTAGRAM", firstName: "Ana", email: "ana@x.com", campaignName: "Nativa Tulum" },
      { connectorId: "conn-vieja", skipRouting: true },
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ targetPlaza: "TULUM" }) }),
    );
  });

  it("sin conector → ninguna lectura de cuenta ni de marca, plaza de las señales y attachBrand no se llama", async () => {
    findFirst.mockResolvedValue(null);
    await captureLead({ source: "WEBSITE", firstName: "Ana", email: "ana@x.com", campaignName: "Nativa Tulum" }, { skipRouting: true });
    expect(connectorFindUnique).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ targetPlaza: "TULUM" }) }),
    );
    expect(getDefaultBrandId).not.toHaveBeenCalled();
    expect(attachBrand).not.toHaveBeenCalled();
  });
});

describe("captureLead — contacto existente que llega por una cuenta de marca", () => {
  it("attachBrand con contactIsNew:false y NO cambia targetPlaza ni assignedToId", async () => {
    findFirst.mockResolvedValue({ id: "c-viejo", assignedToId: "u1", targetPlaza: "TULUM" });
    connectorFindUnique.mockResolvedValue(CUENTA_YAX);
    const r = await captureLead(
      { source: "INSTAGRAM", firstName: "Ana", email: "ana@x.com", campaignName: "Yaxnah Mérida" },
      { connectorId: "conn-yax" },
    );
    expect(r).toEqual({ contactId: "c-viejo", isNew: false, assignedToId: "u1" });
    expect(create).not.toHaveBeenCalled();
    expect(attachBrand).toHaveBeenCalledTimes(1);
    expect(attachBrand).toHaveBeenCalledWith({
      contactId: "c-viejo",
      brandId: "b-yax",
      connectorId: "conn-yax",
      contactIsNew: false,
    });
    // Ninguna actualización del contacto toca la plaza ni el asesor.
    for (const [arg] of update.mock.calls) {
      const data = (arg as { data: Record<string, unknown> }).data;
      expect(data).not.toHaveProperty("targetPlaza");
      expect(data).not.toHaveProperty("assignedToId");
    }
  });

  it("existente por una cuenta sin brandId → attachBrand con la marca predeterminada, contactIsNew:false", async () => {
    findFirst.mockResolvedValue({ id: "c-viejo", assignedToId: "u1" });
    connectorFindUnique.mockResolvedValue({ name: "WhatsApp Propyte", brandId: null, brand: null });
    getDefaultBrandId.mockResolvedValue("b-def");
    await captureLead({ source: "WHATSAPP", firstName: "Ana", email: "ana@x.com" }, { connectorId: "conn-wa" });
    expect(attachBrand).toHaveBeenCalledWith({
      contactId: "c-viejo",
      brandId: "b-def",
      connectorId: "conn-wa",
      contactIsNew: false,
    });
  });
});

describe("captureLead — cuenta sin marca (marca predeterminada)", () => {
  it("cuenta sin brandId → attachBrand con el resultado de getDefaultBrandId()", async () => {
    findFirst.mockResolvedValue(null);
    connectorFindUnique.mockResolvedValue({ name: "WhatsApp Propyte", brandId: null, brand: null });
    getDefaultBrandId.mockResolvedValue("b-def");
    await captureLead({ source: "WHATSAPP", firstName: "Ana", email: "ana@x.com" }, { connectorId: "conn-wa", skipRouting: true });
    expect(getDefaultBrandId).toHaveBeenCalledTimes(1);
    expect(attachBrand).toHaveBeenCalledWith({
      contactId: "c-new",
      brandId: "b-def",
      connectorId: "conn-wa",
      contactIsNew: true,
    });
  });

  it("cuenta sin brandId y getDefaultBrandId() devuelve null → attachBrand no se llama", async () => {
    findFirst.mockResolvedValue(null);
    connectorFindUnique.mockResolvedValue({ name: "WhatsApp Propyte", brandId: null, brand: null });
    getDefaultBrandId.mockResolvedValue(null);
    await captureLead({ source: "WHATSAPP", firstName: "Ana", email: "ana@x.com" }, { connectorId: "conn-wa", skipRouting: true });
    expect(attachBrand).not.toHaveBeenCalled();
  });

  it("la cuenta no se encuentra (findUnique → null) → cae a la marca predeterminada", async () => {
    findFirst.mockResolvedValue(null);
    connectorFindUnique.mockResolvedValue(null);
    getDefaultBrandId.mockResolvedValue("b-def");
    await captureLead({ source: "WHATSAPP", firstName: "Ana", email: "ana@x.com" }, { connectorId: "conn-fantasma", skipRouting: true });
    expect(attachBrand).toHaveBeenCalledWith({
      contactId: "c-new",
      brandId: "b-def",
      connectorId: "conn-fantasma",
      contactIsNew: true,
    });
  });

  it("una cuenta con brandId no consulta la marca predeterminada", async () => {
    findFirst.mockResolvedValue(null);
    connectorFindUnique.mockResolvedValue(CUENTA_YAX);
    await captureLead({ source: "INSTAGRAM", firstName: "Ana", email: "ana@x.com" }, { connectorId: "conn-yax", skipRouting: true });
    expect(getDefaultBrandId).not.toHaveBeenCalled();
  });
});

describe("captureLead — sin connectorId", () => {
  it("no llama attachBrand ni getDefaultBrandId (alta nueva)", async () => {
    findFirst.mockResolvedValue(null);
    await captureLead({ source: "WEBSITE", firstName: "Ana", email: "ana@x.com" }, { skipRouting: true });
    expect(attachBrand).not.toHaveBeenCalled();
    expect(getDefaultBrandId).not.toHaveBeenCalled();
  });

  it("no llama attachBrand (contacto existente)", async () => {
    findFirst.mockResolvedValue({ id: "c-viejo", assignedToId: "u1" });
    await captureLead({ source: "WEBSITE", firstName: "Ana", email: "ana@x.com" });
    expect(attachBrand).not.toHaveBeenCalled();
  });
});

describe("captureLead — atribución fuera del candado", () => {
  it("attachBrand corre con el candado de intake ya cerrado (alta nueva y existente)", async () => {
    findFirst.mockResolvedValueOnce(null);
    connectorFindUnique.mockResolvedValue(CUENTA_YAX);
    await captureLead({ source: "INSTAGRAM", firstName: "Ana", email: "ana@x.com" }, { connectorId: "conn-yax", skipRouting: true });

    findFirst.mockResolvedValueOnce({ id: "c-viejo", assignedToId: "u1" });
    await captureLead({ source: "INSTAGRAM", firstName: "Ana", email: "ana@x.com" }, { connectorId: "conn-yax" });

    expect(lock.openAtAttach).toEqual([false, false]);
  });
});
