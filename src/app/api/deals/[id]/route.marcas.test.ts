// GET/PATCH /api/deals/[id] con filtro por marca (2026-10-12): fuera de marca es el mismo 404
// "no encontrado o sin acceso" que fuera de alcance.
import { describe, it, expect, vi, beforeEach } from "vitest";

let session: { user: { id: string; role: string; plaza: string } } = {
  user: { id: "dir-1", role: "DIRECTOR", plaza: "CANCUN" },
};
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => Promise.resolve(session) }));

const dealFindUnique = vi.fn();
const dealUpdate = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    deal: {
      findUnique: (...a: unknown[]) => dealFindUnique(...a),
      update: (...a: unknown[]) => dealUpdate(...a),
    },
  },
}));
vi.mock("@/lib/commission-engine/for-deal", () => ({ dealCommissionFields: async () => ({}) }));

const getVisibleBrands = vi.fn();
vi.mock("@/lib/brands/user-access", () => ({ getVisibleBrands: (...a: unknown[]) => getVisibleBrands(...a) }));

import { GET, PATCH } from "./route";

const ctx = { params: Promise.resolve({ id: "d1" }) };
const SOLO_PROPYTE = { brandIds: ["b-def"], includesDefault: true };

const negocioYax = {
  id: "d1",
  stage: "NEGOTIATION",
  assignedToId: "ase-2",
  assignedTo: { id: "ase-2", plaza: "CANCUN", teamLeaderId: null },
  contact: { id: "k1", assignedToId: "ase-2", brands: [{ brandId: "b-yax" }] },
  activities: [],
};

beforeEach(() => {
  dealFindUnique.mockReset();
  dealUpdate.mockReset();
  getVisibleBrands.mockReset().mockResolvedValue(SOLO_PROPYTE);
  session = { user: { id: "dir-1", role: "DIRECTOR", plaza: "CANCUN" } };
});

describe("/api/deals/[id] — marcas", () => {
  it("el include del contacto trae sus marcas", async () => {
    dealFindUnique.mockResolvedValue(negocioYax);
    await GET(new Request("https://x") as never, ctx);
    const select = dealFindUnique.mock.calls[0][0].include.contact.select;
    expect(select.assignedToId).toBe(true);
    expect(select.brands).toEqual({ select: { brandId: true } });
  });

  it("GET: DIRECTOR sin Yaxnáh → 404 con el mismo cuerpo que fuera de alcance", async () => {
    dealFindUnique.mockResolvedValue(negocioYax);
    const res = await GET(new Request("https://x") as never, ctx);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Deal no encontrado o sin acceso" });
  });

  it("PATCH: DIRECTOR sin Yaxnáh → 404 y no escribe", async () => {
    dealFindUnique.mockResolvedValue(negocioYax);
    const res = await PATCH(
      new Request("https://x", { method: "PATCH", body: JSON.stringify({ estimatedValue: 5 }) }) as never,
      ctx,
    );
    expect(res.status).toBe(404);
    expect(dealUpdate).not.toHaveBeenCalled();
  });

  it("GET: con Yaxnáh prendida → 200", async () => {
    getVisibleBrands.mockResolvedValue({ brandIds: ["b-def", "b-yax"], includesDefault: true });
    dealFindUnique.mockResolvedValue(negocioYax);
    const res = await GET(new Request("https://x") as never, ctx);
    expect(res.status).toBe(200);
  });

  it("GET: negocio asignado a mí aunque el contacto sea de Yaxnáh → 200", async () => {
    session = { user: { id: "ase-2", role: "ASESOR_SR", plaza: "CANCUN" } };
    dealFindUnique.mockResolvedValue(negocioYax);
    const res = await GET(new Request("https://x") as never, ctx);
    expect(res.status).toBe(200);
  });
});
