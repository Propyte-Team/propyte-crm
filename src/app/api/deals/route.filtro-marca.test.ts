// GET /api/deals con el selector «Marca» de Negocios (2026-10-12, entrega 3). Es lo que recarga
// el tablero (Kanban y tabla) cuando se mueve el selector.
import { describe, it, expect, vi, beforeEach } from "vitest";

const dealFindMany = vi.fn();
const dealCount = vi.fn();
const userFindMany = vi.fn();
const brandFindFirst = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    deal: {
      findMany: (...a: unknown[]) => dealFindMany(...a),
      count: (...a: unknown[]) => dealCount(...a),
    },
    user: { findMany: (...a: unknown[]) => userFindMany(...a) },
    brand: { findFirst: (...a: unknown[]) => brandFindFirst(...a) },
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

const PROPYTE = { id: "b-def", isDefault: true };
const YAXNAH = { id: "b-yax", isDefault: false };
const PROPYTE_Y_YAXNAH = { brandIds: ["b-def", "b-yax"], includesDefault: true };
const SOLO_PROPYTE = { brandIds: ["b-def"], includesDefault: true };

const visNegocio = (userId: string, brandIds: string[]) => ({
  OR: [
    { assignedToId: userId },
    {
      contact: {
        OR: [{ assignedToId: userId }, { brands: { some: { brandId: { in: brandIds } } } }, { brands: { none: {} } }],
      },
    },
  ],
});

const get = (qs = "") => GET(new Request(`https://x/api/deals${qs}`) as never);
const whereUsed = () => dealFindMany.mock.calls[0][0].where;

beforeEach(() => {
  for (const m of [dealFindMany, dealCount, userFindMany, brandFindFirst, getVisibleBrands]) m.mockReset();
  dealFindMany.mockResolvedValue([]);
  dealCount.mockResolvedValue(0);
  userFindMany.mockResolvedValue([]);
  getVisibleBrands.mockResolvedValue(PROPYTE_Y_YAXNAH);
  session = { user: { id: "ase-1", role: "ASESOR_SR", plaza: "CANCUN" } };
});

describe("GET /api/deals — selector «Marca»", () => {
  it("sin ?marca=: igual que la entrega 2 y sin consultar marcas", async () => {
    await get("?pageSize=500");
    expect(whereUsed().AND).toEqual([visNegocio("ase-1", ["b-def", "b-yax"])]);
    expect(brandFindFirst).not.toHaveBeenCalled();
  });

  it("marca que ve: rol (assignedToId) intacto + visibilidad + filtro", async () => {
    brandFindFirst.mockResolvedValue(YAXNAH);
    await get("?pageSize=500&marca=b-yax");
    expect(whereUsed().assignedToId).toBe("ase-1");
    expect(whereUsed().AND).toEqual([
      visNegocio("ase-1", ["b-def", "b-yax"]),
      { contact: { brands: { some: { brandId: "b-yax" } } } },
    ]);
    expect(dealCount.mock.calls[0][0].where).toBe(whereUsed());
  });

  it("la predeterminada: contactos sin filas o con fila de la predeterminada", async () => {
    brandFindFirst.mockResolvedValue(PROPYTE);
    await get("?marca=b-def");
    expect(whereUsed().AND[1]).toEqual({
      contact: { OR: [{ brands: { none: {} } }, { brands: { some: { brandId: "b-def" } } }] },
    });
  });

  it("marca ajena o inexistente → el mismo 400, sin consultar negocios", async () => {
    getVisibleBrands.mockResolvedValue(SOLO_PROPYTE);
    brandFindFirst.mockResolvedValueOnce(YAXNAH);
    const ajena = await get("?marca=b-yax");
    brandFindFirst.mockResolvedValueOnce(null);
    const inexistente = await get("?marca=b-nada");
    expect(ajena.status).toBe(400);
    expect(await ajena.json()).toEqual(await inexistente.json());
    expect(dealFindMany).not.toHaveBeenCalled();
  });

  it("los filtros sueltos (advisorId) no pisan la marca", async () => {
    session = { user: { id: "dir-1", role: "DIRECTOR", plaza: "CANCUN" } };
    brandFindFirst.mockResolvedValue(YAXNAH);
    await get("?advisorId=ase-9&marca=b-yax");
    // #881: filtro por asesor, visibilidad por marca y selector de marca, los tres en el AND.
    expect(whereUsed().assignedToId).toBeUndefined();
    expect(whereUsed().AND).toHaveLength(3);
    expect(whereUsed().AND[0]).toEqual({ assignedToId: "ase-9" });
  });

  it("trae las marcas del contacto para el badge de la tarjeta", async () => {
    await get();
    expect(dealFindMany.mock.calls[0][0].include.contact.select.brands).toEqual({ select: { brandId: true } });
  });
});
