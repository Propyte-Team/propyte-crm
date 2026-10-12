// Selector «Marca» en las server actions que pintan la primera página de Contactos y el tablero
// de Negocios (2026-10-12, entrega 3). Aquí la marca llega del `?marca=` de la URL: una marca que
// el usuario no ve se IGNORA (sale «Todas mis marcas»), porque mostrar lo que ya ve no revela nada.
// En ningún caso el filtro sustituye a la visibilidad: va en el mismo AND.
import { describe, it, expect, vi, beforeEach } from "vitest";

const contactFindMany = vi.fn();
const contactCount = vi.fn();
const dealFindMany = vi.fn();
const userFindMany = vi.fn();
const brandFindFirst = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    contact: {
      findMany: (...a: unknown[]) => contactFindMany(...a),
      count: (...a: unknown[]) => contactCount(...a),
    },
    deal: { findMany: (...a: unknown[]) => dealFindMany(...a) },
    user: { findMany: (...a: unknown[]) => userFindMany(...a) },
    brand: { findFirst: (...a: unknown[]) => brandFindFirst(...a) },
  },
}));

let sesion: { user: { id: string; role: string; plaza: string } } = {
  user: { id: "ger-1", role: "GERENTE", plaza: "CANCUN" },
};
vi.mock("@/lib/auth/session", () => ({ getServerSession: async () => sesion }));
vi.mock("@/lib/webhooks/dispatcher", () => ({ dispatchWebhook: async () => undefined }));

const getVisibleBrands = vi.fn();
vi.mock("@/lib/brands/user-access", () => ({ getVisibleBrands: (...a: unknown[]) => getVisibleBrands(...a) }));

import { getContacts } from "./contacts";
import { getDealsByStage } from "./deals";

const YAXNAH = { id: "b-yax", isDefault: false };
const PROPYTE_Y_YAXNAH = { brandIds: ["b-def", "b-yax"], includesDefault: true };
const SOLO_PROPYTE = { brandIds: ["b-def"], includesDefault: true };

const visContacto = (userId: string, brandIds: string[]) => ({
  OR: [{ assignedToId: userId }, { brands: { some: { brandId: { in: brandIds } } } }, { brands: { none: {} } }],
});
const visNegocio = (userId: string, brandIds: string[]) => ({
  OR: [{ assignedToId: userId }, { contact: visContacto(userId, brandIds) }],
});

beforeEach(() => {
  for (const m of [contactFindMany, contactCount, dealFindMany, userFindMany, brandFindFirst, getVisibleBrands]) {
    m.mockReset();
  }
  contactFindMany.mockResolvedValue([]);
  contactCount.mockResolvedValue(0);
  dealFindMany.mockResolvedValue([]);
  userFindMany.mockResolvedValue([]);
  getVisibleBrands.mockResolvedValue(PROPYTE_Y_YAXNAH);
  sesion = { user: { id: "ger-1", role: "GERENTE", plaza: "CANCUN" } };
});

describe("getContacts({ brandId })", () => {
  it("marca que ve: visibilidad + filtro en el mismo AND; el conteo usa el mismo where", async () => {
    brandFindFirst.mockResolvedValue(YAXNAH);
    await getContacts({ brandId: "b-yax" });
    const where = contactFindMany.mock.calls[0][0].where;
    expect(where.AND).toEqual([visContacto("ger-1", ["b-def", "b-yax"]), { brands: { some: { brandId: "b-yax" } } }]);
    expect(contactCount.mock.calls[0][0].where).toBe(where);
  });

  it("marca que NO ve: se ignora — solo queda la visibilidad, nunca algo más amplio", async () => {
    getVisibleBrands.mockResolvedValue(SOLO_PROPYTE);
    brandFindFirst.mockResolvedValue(YAXNAH);
    await getContacts({ brandId: "b-yax" });
    expect(contactFindMany.mock.calls[0][0].where.AND).toEqual([visContacto("ger-1", ["b-def"])]);
  });

  it("con búsqueda: visibilidad, filtro y búsqueda, los tres en AND", async () => {
    brandFindFirst.mockResolvedValue(YAXNAH);
    await getContacts({ brandId: "b-yax", search: "ana" });
    const and = contactFindMany.mock.calls[0][0].where.AND;
    expect(and).toHaveLength(3);
    expect(and[1]).toEqual({ brands: { some: { brandId: "b-yax" } } });
    expect(and[2].OR).toEqual(expect.arrayContaining([{ firstName: { contains: "ana", mode: "insensitive" } }]));
  });

  it("trae las marcas del contacto para el badge", async () => {
    await getContacts({});
    expect(contactFindMany.mock.calls[0][0].include.brands).toEqual({ select: { brandId: true } });
    expect(brandFindFirst).not.toHaveBeenCalled();
  });
});

describe("getDealsByStage({ brandId })", () => {
  it("sin marca: lo de siempre (rol + visibilidad), sin consultar marcas", async () => {
    await getDealsByStage();
    const where = dealFindMany.mock.calls[0][0].where;
    expect(where.assignedTo).toEqual({ plaza: "CANCUN" });
    expect(where.AND).toEqual([visNegocio("ger-1", ["b-def", "b-yax"])]);
    expect(brandFindFirst).not.toHaveBeenCalled();
  });

  it("marca que ve: el filtro por la marca del contacto se SUMA al AND", async () => {
    brandFindFirst.mockResolvedValue(YAXNAH);
    await getDealsByStage({ brandId: "b-yax" });
    const where = dealFindMany.mock.calls[0][0].where;
    expect(where.assignedTo).toEqual({ plaza: "CANCUN" });
    expect(where.AND).toEqual([
      visNegocio("ger-1", ["b-def", "b-yax"]),
      { contact: { brands: { some: { brandId: "b-yax" } } } },
    ]);
  });

  it("marca que NO ve: se ignora", async () => {
    getVisibleBrands.mockResolvedValue(SOLO_PROPYTE);
    brandFindFirst.mockResolvedValue(YAXNAH);
    await getDealsByStage({ brandId: "b-yax" });
    expect(dealFindMany.mock.calls[0][0].where.AND).toEqual([visNegocio("ger-1", ["b-def"])]);
  });

  it("ADMIN: rol sin filtro, solo el recorte elegido", async () => {
    sesion = { user: { id: "adm-1", role: "ADMIN", plaza: "CANCUN" } };
    getVisibleBrands.mockResolvedValue("ALL");
    brandFindFirst.mockResolvedValue(YAXNAH);
    await getDealsByStage({ brandId: "b-yax" });
    expect(dealFindMany.mock.calls[0][0].where).toEqual({
      deletedAt: null,
      AND: [{ contact: { brands: { some: { brandId: "b-yax" } } } }],
    });
  });

  it("la tarjeta trae las marcas del contacto para el badge", async () => {
    await getDealsByStage();
    expect(dealFindMany.mock.calls[0][0].include.contact.select.brands).toEqual({ select: { brandId: true } });
  });
});
