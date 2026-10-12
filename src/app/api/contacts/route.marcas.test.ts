// GET /api/contacts con filtro por marca (2026-10-12, spec marcas-visibilidad). Es la ruta de la
// lista de contactos y de TODOS los buscadores de contacto (agenda, actividades, alta de negocio).
import { describe, it, expect, vi, beforeEach } from "vitest";

const contactFindMany = vi.fn();
const contactCount = vi.fn();
const userFindMany = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    contact: {
      findMany: (...a: unknown[]) => contactFindMany(...a),
      count: (...a: unknown[]) => contactCount(...a),
    },
    user: { findMany: (...a: unknown[]) => userFindMany(...a) },
  },
}));

const getServerSession = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => getServerSession() }));
vi.mock("@/lib/api/orden", () => ({ ordenValidado: () => ({ orderBy: undefined, error: null }) }));

const getVisibleBrands = vi.fn();
vi.mock("@/lib/brands/user-access", () => ({ getVisibleBrands: (...a: unknown[]) => getVisibleBrands(...a) }));

import { GET } from "./route";

const SOLO_PROPYTE = { brandIds: ["b-def"], includesDefault: true };
const marcaDe = (userId: string) => ({
  OR: [
    { assignedToId: userId },
    { brands: { some: { brandId: { in: ["b-def"] } } } },
    { brands: { none: {} } },
  ],
});

function get(qs = "") {
  return GET(new Request(`https://x/api/contacts${qs}`) as never);
}
function whereUsed() {
  return contactFindMany.mock.calls[0][0].where;
}

beforeEach(() => {
  for (const m of [contactFindMany, contactCount, userFindMany, getServerSession, getVisibleBrands]) m.mockReset();
  contactFindMany.mockResolvedValue([]);
  contactCount.mockResolvedValue(0);
  userFindMany.mockResolvedValue([{ id: "ase-2" }]);
  getVisibleBrands.mockResolvedValue(SOLO_PROPYTE);
});

describe("GET /api/contacts — marcas", () => {
  it("MARKETING (ve todo por rol) queda recortado por marca", async () => {
    getServerSession.mockResolvedValue({ user: { id: "mkt-1", role: "MARKETING", plaza: "CANCUN" } });
    await get();
    expect(whereUsed().AND).toEqual([marcaDe("mkt-1")]);
    expect(contactCount.mock.calls[0][0].where).toBe(whereUsed());
  });

  it("asesor: su alcance (assignedToId) intacto + marca en AND", async () => {
    getServerSession.mockResolvedValue({ user: { id: "ase-1", role: "ASESOR_SR", plaza: "CANCUN" } });
    await get();
    expect(whereUsed().assignedToId).toBe("ase-1");
    expect(whereUsed().AND).toEqual([marcaDe("ase-1")]);
  });

  it("GERENTE con búsqueda (el picker): plaza + búsqueda + marca, las tres en AND", async () => {
    getServerSession.mockResolvedValue({ user: { id: "ger-1", role: "GERENTE", plaza: "CANCUN" } });
    await get("?search=ana&pageSize=6");
    const and = whereUsed().AND;
    expect(and).toHaveLength(3);
    expect(and[0]).toEqual({ OR: [{ assignedToId: { in: ["ase-2"] } }, { assignedToId: null }] });
    expect(and[1].OR).toEqual(expect.arrayContaining([{ firstName: { contains: "ana", mode: "insensitive" } }]));
    expect(and[2]).toEqual(marcaDe("ger-1"));
  });

  it("los filtros sueltos (assignedTo) no pisan la marca", async () => {
    getServerSession.mockResolvedValue({ user: { id: "dir-1", role: "DIRECTOR", plaza: "CANCUN" } });
    await get("?assignedTo=ase-9");
    expect(whereUsed().assignedToId).toBe("ase-9");
    expect(whereUsed().AND).toEqual([marcaDe("dir-1")]);
  });

  it("ADMIN (ALL): sin término de marca", async () => {
    getServerSession.mockResolvedValue({ user: { id: "adm-1", role: "ADMIN", plaza: "CANCUN" } });
    getVisibleBrands.mockResolvedValue("ALL");
    await get();
    expect(whereUsed().AND).toBeUndefined();
  });
});
