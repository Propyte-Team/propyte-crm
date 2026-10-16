// GET /api/deals (tablero del pipeline, pageSize=500) con filtro por marca (2026-10-12).
import { describe, it, expect, vi, beforeEach } from "vitest";

const dealFindMany = vi.fn();
const dealCount = vi.fn();
const userFindMany = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    deal: {
      findMany: (...a: unknown[]) => dealFindMany(...a),
      count: (...a: unknown[]) => dealCount(...a),
    },
    user: { findMany: (...a: unknown[]) => userFindMany(...a) },
  },
}));

let session: { user: { id: string; role: string; plaza: string } } = {
  user: { id: "ase-1", role: "ASESOR_SR", plaza: "CANCUN" },
};
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => Promise.resolve(session) }));
vi.mock("@/lib/api/orden", () => ({ ordenValidado: () => ({ orderBy: undefined, error: null }) }));

const getVisibleBrands = vi.fn();
vi.mock("@/lib/brands/user-access", () => ({ getVisibleBrands: (...a: unknown[]) => getVisibleBrands(...a) }));

import { GET } from "./route";

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

function get(qs = "") {
  return GET(new Request(`https://x/api/deals${qs}`) as never);
}
function whereUsed() {
  return dealFindMany.mock.calls[0][0].where;
}

beforeEach(() => {
  for (const m of [dealFindMany, dealCount, userFindMany, getVisibleBrands]) m.mockReset();
  dealFindMany.mockResolvedValue([]);
  dealCount.mockResolvedValue(0);
  userFindMany.mockResolvedValue([]);
  getVisibleBrands.mockResolvedValue(SOLO_PROPYTE);
});

describe("GET /api/deals — marcas", () => {
  it("DIRECTOR (sin filtro por rol) queda recortado por marca, en lista y conteo", async () => {
    session = { user: { id: "dir-1", role: "DIRECTOR", plaza: "CANCUN" } };
    await get("?pageSize=500");
    expect(whereUsed().AND).toEqual([marcaNegocio("dir-1")]);
    expect(dealCount.mock.calls[0][0].where).toBe(whereUsed());
  });

  it("GERENTE: plaza intacta + marca en AND, aunque venga ?advisorId=", async () => {
    session = { user: { id: "ger-1", role: "GERENTE", plaza: "CANCUN" } };
    await get("?advisorId=ase-3");
    expect(whereUsed().assignedTo).toEqual({ plaza: "CANCUN" });
    // #881: el asesor pedido va en el AND, sumado a la plaza; la marca, detrás.
    expect(whereUsed().AND).toEqual([{ assignedToId: "ase-3" }, marcaNegocio("ger-1")]);
  });

  it("asesor: lo suyo + marca (lo suyo siempre pasa la marca: el término assignedToId está en el OR)", async () => {
    session = { user: { id: "ase-1", role: "ASESOR_SR", plaza: "CANCUN" } };
    await get();
    expect(whereUsed().assignedToId).toBe("ase-1");
    expect(whereUsed().AND).toEqual([marcaNegocio("ase-1")]);
  });

  it("ADMIN (ALL): sin término de marca", async () => {
    session = { user: { id: "adm-1", role: "ADMIN", plaza: "CANCUN" } };
    getVisibleBrands.mockResolvedValue("ALL");
    await get();
    expect(whereUsed().AND).toBeUndefined();
  });
});
