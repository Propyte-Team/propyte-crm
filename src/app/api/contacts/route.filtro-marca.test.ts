// GET /api/contacts con el selector «Marca» (2026-10-12, entrega 3). El filtro va en el MISMO AND
// que la visibilidad por marca de la entrega 2 y nunca la reemplaza; una marca ajena o inexistente
// responde el mismo 400.
import { describe, it, expect, vi, beforeEach } from "vitest";

const contactFindMany = vi.fn();
const contactCount = vi.fn();
const userFindMany = vi.fn();
const brandFindFirst = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    contact: {
      findMany: (...a: unknown[]) => contactFindMany(...a),
      count: (...a: unknown[]) => contactCount(...a),
    },
    user: { findMany: (...a: unknown[]) => userFindMany(...a) },
    brand: { findFirst: (...a: unknown[]) => brandFindFirst(...a) },
  },
}));

const getServerSession = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => getServerSession() }));
vi.mock("@/lib/api/orden", () => ({ ordenValidado: () => ({ orderBy: undefined, error: null }) }));

const getVisibleBrands = vi.fn();
vi.mock("@/lib/brands/user-access", () => ({ getVisibleBrands: (...a: unknown[]) => getVisibleBrands(...a) }));

import { GET } from "./route";

const PROPYTE = { id: "b-def", isDefault: true };
const YAXNAH = { id: "b-yax", isDefault: false };
const PROPYTE_Y_YAXNAH = { brandIds: ["b-def", "b-yax"], includesDefault: true };
const SOLO_PROPYTE = { brandIds: ["b-def"], includesDefault: true };

const visibilidad = (userId: string, brandIds: string[]) => ({
  OR: [{ assignedToId: userId }, { brands: { some: { brandId: { in: brandIds } } } }, { brands: { none: {} } }],
});

function get(qs = "") {
  return GET(new Request(`https://x/api/contacts${qs}`) as never);
}
const whereUsed = () => contactFindMany.mock.calls[0][0].where;

beforeEach(() => {
  for (const m of [contactFindMany, contactCount, userFindMany, brandFindFirst, getServerSession, getVisibleBrands]) {
    m.mockReset();
  }
  contactFindMany.mockResolvedValue([]);
  contactCount.mockResolvedValue(0);
  userFindMany.mockResolvedValue([]);
  getServerSession.mockResolvedValue({ user: { id: "dir-1", role: "DIRECTOR", plaza: "CANCUN" } });
  getVisibleBrands.mockResolvedValue(PROPYTE_Y_YAXNAH);
});

describe("GET /api/contacts — selector «Marca»", () => {
  it("sin ?marca= no consulta marcas y el where es el de la entrega 2", async () => {
    await get();
    expect(brandFindFirst).not.toHaveBeenCalled();
    expect(whereUsed().AND).toEqual([visibilidad("dir-1", ["b-def", "b-yax"])]);
  });

  it("marca que ve: visibilidad Y filtro, en el mismo AND (acota, no reemplaza)", async () => {
    brandFindFirst.mockResolvedValue(YAXNAH);
    await get("?marca=b-yax");
    expect(whereUsed().AND).toEqual([
      visibilidad("dir-1", ["b-def", "b-yax"]),
      { brands: { some: { brandId: "b-yax" } } },
    ]);
    expect(contactCount.mock.calls[0][0].where).toBe(whereUsed());
  });

  it("la predeterminada incluye a los contactos sin filas", async () => {
    brandFindFirst.mockResolvedValue(PROPYTE);
    await get("?marca=b-def");
    expect(whereUsed().AND[1]).toEqual({
      OR: [{ brands: { none: {} } }, { brands: { some: { brandId: "b-def" } } }],
    });
  });

  it("marca que NO ve → 400, sin tocar contactos", async () => {
    getVisibleBrands.mockResolvedValue(SOLO_PROPYTE);
    brandFindFirst.mockResolvedValue(YAXNAH);
    const res = await get("?marca=b-yax");
    expect(res.status).toBe(400);
    expect(contactFindMany).not.toHaveBeenCalled();
  });

  it("ajena e inexistente responden EXACTAMENTE igual (no se delata que existe)", async () => {
    getVisibleBrands.mockResolvedValue(SOLO_PROPYTE);
    brandFindFirst.mockResolvedValueOnce(YAXNAH);
    const ajena = await get("?marca=b-yax");
    brandFindFirst.mockResolvedValueOnce(null);
    const inexistente = await get("?marca=b-nada");
    expect(ajena.status).toBe(inexistente.status);
    expect(await ajena.json()).toEqual(await inexistente.json());
  });

  it("asesor: su alcance por rol sigue intacto y el filtro se suma", async () => {
    getServerSession.mockResolvedValue({ user: { id: "ase-1", role: "ASESOR_SR", plaza: "CANCUN" } });
    brandFindFirst.mockResolvedValue(YAXNAH);
    await get("?marca=b-yax");
    expect(whereUsed().assignedToId).toBe("ase-1");
    expect(whereUsed().AND).toEqual([
      visibilidad("ase-1", ["b-def", "b-yax"]),
      { brands: { some: { brandId: "b-yax" } } },
    ]);
  });

  it("ADMIN (ALL): solo el filtro, sin término de visibilidad", async () => {
    getServerSession.mockResolvedValue({ user: { id: "adm-1", role: "ADMIN", plaza: "CANCUN" } });
    getVisibleBrands.mockResolvedValue("ALL");
    brandFindFirst.mockResolvedValue(YAXNAH);
    await get("?marca=b-yax");
    expect(whereUsed().AND).toEqual([{ brands: { some: { brandId: "b-yax" } } }]);
  });

  it("la lista trae las marcas del contacto para el badge", async () => {
    await get();
    expect(contactFindMany.mock.calls[0][0].include.brands).toEqual({ select: { brandId: true } });
  });
});
