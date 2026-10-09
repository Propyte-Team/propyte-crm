// GET /api/admin/brands/developments?q= (2026-10-09): buscador de desarrollos PUBLICADOS del Hub
// para armar la lista de una marca. Lectura abierta al mismo equipo que ve las conexiones.
import { describe, it, expect, vi, beforeEach } from "vitest";

const session: { user: { id: string; role: string } } = { user: { id: "u1", role: "MARKETING" } };
let hasSession = true;
vi.mock("@/lib/auth/session", () => ({
  getServerSession: () => Promise.resolve(hasSession ? session : null),
}));

const listPublished = vi.fn();
vi.mock("@/lib/hub/catalog", () => ({
  listPublishedDevelopments: (...a: unknown[]) => listPublished(...a),
}));

import { GET } from "./route";

const req = (qs = "") => new Request(`http://t/api/admin/brands/developments${qs}`) as never;

const ROW = {
  id: "d1",
  name: "Nativa Tulum",
  city: "Tulum",
  slug: "nativa-tulum",
  priceMinMxn: 1,
  publishedUnits: 3,
};

beforeEach(() => {
  listPublished.mockReset();
  hasSession = true;
  session.user.role = "MARKETING";
  listPublished.mockResolvedValue({ data: [ROW], error: null });
});

describe("GET /api/admin/brands/developments", () => {
  it("sin sesión o con rol ASESOR → 403", async () => {
    hasSession = false;
    expect((await GET(req("?q=nat"))).status).toBe(403);
    hasSession = true;
    session.user.role = "ASESOR";
    expect((await GET(req("?q=nat"))).status).toBe(403);
    expect(listPublished).not.toHaveBeenCalled();
  });

  it("MARKETING busca por nombre y recibe solo { id, name, city }", async () => {
    const res = await GET(req("?q=nat"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: [{ id: "d1", name: "Nativa Tulum", city: "Tulum" }] });
    expect(listPublished).toHaveBeenCalledWith({ search: "nat", limit: 20 });
  });

  it("sin q (o vacío) lista sin filtro de texto", async () => {
    await GET(req());
    expect(listPublished).toHaveBeenLastCalledWith({ search: undefined, limit: 20 });
    await GET(req("?q=%20%20"));
    expect(listPublished).toHaveBeenLastCalledWith({ search: undefined, limit: 20 });
  });

  it("recorta q a 100 caracteres", async () => {
    await GET(req(`?q=${"a".repeat(300)}`));
    expect(listPublished.mock.calls[0][0].search).toHaveLength(100);
  });

  it("si el Hub falla → 502 con el mensaje de error", async () => {
    listPublished.mockResolvedValue({ data: [], error: "No se pudo consultar el catálogo del Hub" });
    const res = await GET(req("?q=nat"));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("No se pudo consultar el catálogo del Hub");
  });
});
