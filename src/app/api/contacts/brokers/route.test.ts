import { describe, it, expect, vi, beforeEach } from "vitest";

const getServerSession = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => getServerSession() }));

const findMany = vi.fn();
const count = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    contact: {
      findMany: (...a: unknown[]) => findMany(...a),
      count: (...a: unknown[]) => count(...a),
    },
  },
}));

const getVisibleBrands = vi.fn();
vi.mock("@/lib/brands/user-access", () => ({ getVisibleBrands: (...a: unknown[]) => getVisibleBrands(...a) }));

import { GET } from "./route";

function req(qs = "") {
  return new Request(`https://x/api/contacts/brokers${qs}`) as unknown as import("next/server").NextRequest;
}

const ASESOR = { user: { id: "ase-1", role: "ASESOR_JR" } };

beforeEach(() => {
  [getServerSession, findMany, count, getVisibleBrands].forEach((m) => m.mockReset());
  getServerSession.mockResolvedValue(ASESOR);
  getVisibleBrands.mockResolvedValue("ALL");
  findMany.mockResolvedValue([]);
  count.mockResolvedValue(0);
});

describe("GET /api/contacts/brokers (#935)", () => {
  it("sin sesión: 401", async () => {
    getServerSession.mockResolvedValue(null);
    expect((await GET(req())).status).toBe(401);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("rol desconocido: 403", async () => {
    getServerSession.mockResolvedValue({ user: { id: "x", role: "ROL_INVENTADO" } });
    expect((await GET(req())).status).toBe(403);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("asesor: lista brokers de cualquier dueño, de 30 en 30, ordenados por nombre", async () => {
    findMany.mockResolvedValue([{ id: "b-1", firstName: "Javi", lastName: "Mendez" }]);
    count.mockResolvedValue(339);
    const body = await (await GET(req())).json();
    expect(body).toEqual({ data: [{ id: "b-1", name: "Javi Mendez" }], total: 339, page: 1, hasMore: true });
    const args = findMany.mock.calls[0][0];
    expect(args.where).toEqual({ deletedAt: null, contactType: "BROKER_EXTERNO" });
    expect(args.take).toBe(30);
    expect(args.skip).toBe(0);
    expect(args.orderBy[0]).toEqual({ firstName: "asc" });
    // Solo id y nombre: nada de teléfono, correo ni dueño.
    expect(args.select).toEqual({ id: true, firstName: true, lastName: true });
  });

  it("página 12 de 339: skip 330 y ya no hay más", async () => {
    count.mockResolvedValue(339);
    const body = await (await GET(req("?page=12"))).json();
    expect(findMany.mock.calls[0][0].skip).toBe(330);
    expect(body.hasMore).toBe(false);
  });

  it("page inválido cae en 1", async () => {
    await GET(req("?page=abc"));
    expect(findMany.mock.calls[0][0].skip).toBe(0);
  });

  it("search y excluir llegan al where; count usa el mismo where", async () => {
    await GET(req("?search=Karen&excluir=c-1"));
    const where = findMany.mock.calls[0][0].where;
    expect(where.id).toEqual({ not: "c-1" });
    expect(where.AND).toHaveLength(1);
    expect(count.mock.calls[0][0].where).toEqual(where);
  });

  it("error de base: 500 sin filtrar el mensaje", async () => {
    findMany.mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await GET(req());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Error interno del servidor");
  });
});
