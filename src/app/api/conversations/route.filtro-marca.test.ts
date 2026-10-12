// GET /api/conversations con el selector «Marca» de la bandeja (2026-10-12, entrega 3). El filtro
// es por la marca de la CUENTA del hilo y va encima del alcance (rol + visibilidad por marca del
// contacto), que no se toca.
import { describe, it, expect, vi, beforeEach } from "vitest";

const getServerSession = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => getServerSession() }));

const convFindMany = vi.fn();
const brandFindFirst = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    conversation: { findMany: (...a: unknown[]) => convFindMany(...a) },
    brand: { findFirst: (...a: unknown[]) => brandFindFirst(...a) },
  },
}));

const getVisibleBrands = vi.fn();
vi.mock("@/lib/brands/user-access", () => ({ getVisibleBrands: (...a: unknown[]) => getVisibleBrands(...a) }));

import { GET } from "./route";

const PROPYTE = { id: "b-def", isDefault: true };
const YAXNAH = { id: "b-yax", isDefault: false };
const PROPYTE_Y_YAXNAH = { brandIds: ["b-def", "b-yax"], includesDefault: true };
const SOLO_PROPYTE = { brandIds: ["b-def"], includesDefault: true };

const req = (qs = "") => ({ nextUrl: new URL(`http://x/api/conversations${qs}`) }) as never;
const whereUsed = () => convFindMany.mock.calls[0][0].where;

const ASESOR = { user: { id: "ase-1", role: "ASESOR_SR" } };
const GERENTE = { user: { id: "ger-1", role: "GERENTE" } };

beforeEach(() => {
  [getServerSession, convFindMany, brandFindFirst, getVisibleBrands].forEach((m) => m.mockReset());
  convFindMany.mockResolvedValue([]);
  getVisibleBrands.mockResolvedValue(PROPYTE_Y_YAXNAH);
  getServerSession.mockResolvedValue(ASESOR);
});

describe("GET /api/conversations — selector «Marca»", () => {
  it("sin ?marca=: sin recorte de cuenta y sin consultar marcas", async () => {
    await GET(req());
    expect(whereUsed().AND).toBeUndefined();
    expect(brandFindFirst).not.toHaveBeenCalled();
  });

  it("marca que ve: filtra por la marca de la cuenta y el alcance del contacto sigue igual", async () => {
    brandFindFirst.mockResolvedValue(YAXNAH);
    await GET(req("?filter=unassigned&marca=b-yax"));
    const where = whereUsed();
    expect(where.AND).toEqual([{ connector: { is: { brandId: "b-yax" } } }]);
    // alcance por rol + visibilidad por marca del contacto + la pestaña: intactos
    expect(where.contact.AND).toHaveLength(2);
    expect(where.contact.AND[0].AND[0]).toEqual({ OR: [{ assignedToId: "ase-1" }, { assignedToId: null }] });
    expect(where.contact.AND[1]).toEqual({ assignedToId: null });
  });

  it("la predeterminada: hilos sin cuenta, con cuenta sin marca o de la predeterminada", async () => {
    getServerSession.mockResolvedValue(GERENTE);
    brandFindFirst.mockResolvedValue(PROPYTE);
    await GET(req("?marca=b-def"));
    expect(whereUsed().AND).toEqual([
      {
        OR: [
          { connectorId: null },
          { connector: { is: { brandId: null } } },
          { connector: { is: { brandId: "b-def" } } },
        ],
      },
    ]);
  });

  it("marca ajena o inexistente → el mismo 400, sin listar nada", async () => {
    getVisibleBrands.mockResolvedValue(SOLO_PROPYTE);
    brandFindFirst.mockResolvedValueOnce(YAXNAH);
    const ajena = await GET(req("?marca=b-yax"));
    brandFindFirst.mockResolvedValueOnce(null);
    const inexistente = await GET(req("?marca=b-nada"));
    expect(ajena.status).toBe(400);
    expect(await ajena.json()).toEqual(await inexistente.json());
    expect(convFindMany).not.toHaveBeenCalled();
  });

  it("ADMIN puede filtrar por cualquier marca viva", async () => {
    getServerSession.mockResolvedValue({ user: { id: "adm-1", role: "ADMIN" } });
    getVisibleBrands.mockResolvedValue("ALL");
    brandFindFirst.mockResolvedValue(YAXNAH);
    const res = await GET(req("?marca=b-yax"));
    expect(res.status).toBe(200);
    expect(whereUsed().AND).toEqual([{ connector: { is: { brandId: "b-yax" } } }]);
    expect(whereUsed().contact).toBeUndefined();
  });

  it("cada hilo trae la marca de su cuenta para el badge", async () => {
    convFindMany.mockResolvedValue([
      {
        id: "c1",
        connector: { name: "WA Yaxnáh", config: {}, brandId: "b-yax", brand: { name: "Yaxnáh Caucel" } },
        contact: { id: "k1", custom: {} },
        messages: [],
      },
      { id: "c2", connector: null, contact: { id: "k2", custom: {} }, messages: [] },
    ]);
    const res = await GET(req());
    const { data } = await res.json();
    expect(convFindMany.mock.calls[0][0].select.connector.select.brandId).toBe(true);
    expect(data[0].connector).toEqual({ name: "WA Yaxnáh", brand: "Yaxnáh Caucel", brandId: "b-yax" });
    expect(data[1].connector).toBeNull();
  });
});
