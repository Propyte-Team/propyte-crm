// Pipeline con filtro por marca (2026-10-12, spec marcas-visibilidad). El negocio hereda la
// marca de su contacto; la marca va con AND encima del alcance por rol de buildRBACFilter.
import { describe, it, expect, vi, beforeEach } from "vitest";

const dealFindMany = vi.fn();
const dealCount = vi.fn();
const dealGroupBy = vi.fn();
const dealFindUnique = vi.fn();
const userFindMany = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    deal: {
      findMany: (...a: unknown[]) => dealFindMany(...a),
      count: (...a: unknown[]) => dealCount(...a),
      groupBy: (...a: unknown[]) => dealGroupBy(...a),
      findUnique: (...a: unknown[]) => dealFindUnique(...a),
    },
    user: { findMany: (...a: unknown[]) => userFindMany(...a) },
  },
}));

let sesion: { user: { id: string; role: string; plaza: string } } = {
  user: { id: "ger-1", role: "GERENTE", plaza: "CANCUN" },
};
vi.mock("@/lib/auth/session", () => ({ getServerSession: async () => sesion }));
vi.mock("@/lib/webhooks/dispatcher", () => ({ dispatchWebhook: async () => undefined }));

const getVisibleBrands = vi.fn();
vi.mock("@/lib/brands/user-access", () => ({ getVisibleBrands: (...a: unknown[]) => getVisibleBrands(...a) }));

import { getDeals, getDealsByStage, getStagnantDeals, getDeal } from "./deals";

const SOLO_PROPYTE = { brandIds: ["b-def"], includesDefault: true };
const marcaNegocio = (userId: string) => ({
  OR: [
    { assignedToId: userId },
    {
      contact: {
        OR: [
          { assignedToId: userId },
          { brands: { some: { brandId: { in: ["b-def"] } } } },
          { brands: { none: {} } },
        ],
      },
    },
  ],
});

beforeEach(() => {
  for (const m of [dealFindMany, dealCount, dealGroupBy, dealFindUnique, userFindMany, getVisibleBrands]) m.mockReset();
  dealFindMany.mockResolvedValue([]);
  dealCount.mockResolvedValue(0);
  dealGroupBy.mockResolvedValue([]);
  userFindMany.mockResolvedValue([]);
  getVisibleBrands.mockResolvedValue(SOLO_PROPYTE);
  sesion = { user: { id: "ger-1", role: "GERENTE", plaza: "CANCUN" } };
});

describe("listas del pipeline", () => {
  it("getDealsByStage (tablero): alcance de plaza + marca en AND", async () => {
    await getDealsByStage();
    const where = dealFindMany.mock.calls[0][0].where;
    expect(where.assignedTo).toEqual({ plaza: "CANCUN" });
    expect(where.AND).toEqual([marcaNegocio("ger-1")]);
    expect(getVisibleBrands).toHaveBeenCalledWith({ id: "ger-1", role: "GERENTE" });
  });

  it("getDeals: la marca sobrevive a los filtros sueltos y alcanza a los agregados por etapa", async () => {
    await getDeals({ assignedToId: "ase-9", stage: "CONTACTED" });
    const where = dealFindMany.mock.calls[0][0].where;
    expect(where.assignedToId).toBe("ase-9");
    expect(where.AND).toEqual([marcaNegocio("ger-1")]);
    expect(dealGroupBy.mock.calls[0][0].where.AND).toEqual([marcaNegocio("ger-1")]);
  });

  it("getStagnantDeals: también recortado por marca", async () => {
    await getStagnantDeals();
    expect(dealFindMany.mock.calls[0][0].where.AND).toEqual([marcaNegocio("ger-1")]);
  });

  it("ADMIN (ALL): sin término de marca", async () => {
    sesion = { user: { id: "adm-1", role: "ADMIN", plaza: "CANCUN" } };
    getVisibleBrands.mockResolvedValue("ALL");
    await getDealsByStage();
    expect(dealFindMany.mock.calls[0][0].where.AND).toBeUndefined();
  });
});

describe("getDeal (detalle del negocio)", () => {
  const negocioYax = {
    id: "d1",
    assignedToId: "ase-2",
    assignedTo: { plaza: "CANCUN", teamLeaderId: null },
    contact: { id: "k1", assignedToId: "ase-2", brands: [{ brandId: "b-yax" }] },
  };

  it("trae el contacto con sus marcas", async () => {
    dealFindUnique.mockResolvedValue(negocioYax);
    await getDeal("d1");
    const select = dealFindUnique.mock.calls[0][0].include.contact.select;
    expect(select.assignedToId).toBe(true);
    expect(select.brands).toEqual({ select: { brandId: true } });
  });

  it("GERENTE de la plaza pero sin Yaxnáh → null (la página da 404)", async () => {
    dealFindUnique.mockResolvedValue(negocioYax);
    expect(await getDeal("d1")).toBeNull();
  });

  it("con Yaxnáh → lo devuelve", async () => {
    getVisibleBrands.mockResolvedValue({ brandIds: ["b-def", "b-yax"], includesDefault: true });
    dealFindUnique.mockResolvedValue(negocioYax);
    expect(await getDeal("d1")).toMatchObject({ id: "d1" });
  });

  it("la marca no amplía el rol: GERENTE de otra plaza con Yaxnáh → null", async () => {
    getVisibleBrands.mockResolvedValue({ brandIds: ["b-def", "b-yax"], includesDefault: true });
    dealFindUnique.mockResolvedValue({ ...negocioYax, assignedTo: { plaza: "MERIDA", teamLeaderId: null } });
    expect(await getDeal("d1")).toBeNull();
  });
});
