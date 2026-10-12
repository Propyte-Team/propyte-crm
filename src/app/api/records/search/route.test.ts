// Buscador de records (paleta de comandos + picker de relaciones) con filtro por marca
// (2026-10-12, spec marcas-visibilidad). No tiene alcance por rol, pero sí recorta por marca.
import { describe, it, expect, vi, beforeEach } from "vitest";

const contactFindMany = vi.fn();
const dealFindMany = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    contact: { findMany: (...a: unknown[]) => contactFindMany(...a) },
    deal: { findMany: (...a: unknown[]) => dealFindMany(...a) },
  },
}));

const getServerSession = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => getServerSession() }));
vi.mock("@/lib/bot/hub-catalog", () => ({ findMatchingDevelopments: async () => ({ data: [], error: null }) }));

const getVisibleBrands = vi.fn();
vi.mock("@/lib/brands/user-access", () => ({ getVisibleBrands: (...a: unknown[]) => getVisibleBrands(...a) }));

import { GET } from "./route";

const SOLO_PROPYTE = { brandIds: ["b-def"], includesDefault: true };
const MARCA_CONTACTO = {
  OR: [
    { assignedToId: "u1" },
    { brands: { some: { brandId: { in: ["b-def"] } } } },
    { brands: { none: {} } },
  ],
};

function req(object: string, q = "ana") {
  return { nextUrl: new URL(`http://x/api/records/search?object=${object}&q=${q}`) } as never;
}

beforeEach(() => {
  for (const m of [contactFindMany, dealFindMany, getServerSession, getVisibleBrands]) m.mockReset();
  contactFindMany.mockResolvedValue([]);
  dealFindMany.mockResolvedValue([]);
  getServerSession.mockResolvedValue({ user: { id: "u1", role: "GERENTE" } });
  getVisibleBrands.mockResolvedValue(SOLO_PROPYTE);
});

describe("GET /api/records/search — marcas", () => {
  it("contactos: la búsqueda (OR) intacta y la marca en AND", async () => {
    await GET(req("contact"));
    const where = contactFindMany.mock.calls[0][0].where;
    expect(where.OR).toEqual(expect.arrayContaining([{ firstName: { contains: "ana", mode: "insensitive" } }]));
    expect(where.AND).toEqual([MARCA_CONTACTO]);
  });

  it("negocios: suyos o de un contacto de una marca visible", async () => {
    await GET(req("deal"));
    const where = dealFindMany.mock.calls[0][0].where;
    expect(where.contact.OR).toBeDefined(); // la búsqueda por nombre del contacto sigue
    expect(where.AND).toEqual([{ OR: [{ assignedToId: "u1" }, { contact: MARCA_CONTACTO }] }]);
  });

  it("ADMIN (ALL): sin término de marca", async () => {
    getServerSession.mockResolvedValue({ user: { id: "a1", role: "ADMIN" } });
    getVisibleBrands.mockResolvedValue("ALL");
    await GET(req("contact"));
    expect(contactFindMany.mock.calls[0][0].where.AND).toBeUndefined();
  });

  it("menos de 2 letras: no consulta nada (ni las marcas)", async () => {
    await GET(req("contact", "a"));
    expect(contactFindMany).not.toHaveBeenCalled();
    expect(getVisibleBrands).not.toHaveBeenCalled();
  });
});
