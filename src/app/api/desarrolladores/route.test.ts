import { describe, it, expect, vi, beforeEach } from "vitest";

// #872 — API de Desarrolladores: todos consultan; ADMIN y DIRECTOR escriben.

const findMany = vi.fn();
const create = vi.fn();
const findFirst = vi.fn();
const update = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    developerPartner: {
      findMany: (...a: unknown[]) => findMany(...a),
      create: (...a: unknown[]) => create(...a),
      findFirst: (...a: unknown[]) => findFirst(...a),
      update: (...a: unknown[]) => update(...a),
    },
  },
}));
let sesion: { user: { id: string; role: string } } | null = null;
vi.mock("@/lib/auth/session", () => ({ getServerSession: async () => sesion }));

import { GET, POST } from "./route";
import { PATCH } from "./[id]/route";

const post = (body: unknown) =>
  POST(new Request("http://x/api/desarrolladores", { method: "POST", body: JSON.stringify(body) }) as never);
const patch = (id: string, body: unknown) =>
  PATCH(new Request(`http://x/api/desarrolladores/${id}`, { method: "PATCH", body: JSON.stringify(body) }) as never, {
    params: Promise.resolve({ id }),
  });

beforeEach(() => {
  for (const m of [findMany, create, findFirst, update]) m.mockReset();
  sesion = { user: { id: "u1", role: "ASESOR" } };
});

describe("GET /api/desarrolladores", () => {
  it("sin sesión → 401", async () => {
    sesion = null;
    expect((await GET()).status).toBe(401);
  });
  it("cualquier rol consulta", async () => {
    findMany.mockResolvedValue([{ id: "d1", name: "Onix", website: null, email: null, phone: null }]);
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).data).toHaveLength(1);
    expect(findMany.mock.calls[0][0].where).toEqual({ deletedAt: null });
  });
  it("tabla aún no creada (P2021) → lista vacía, no error", async () => {
    findMany.mockRejectedValue(Object.assign(new Error("no table"), { code: "P2021" }));
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: [] });
  });
});

describe("POST /api/desarrolladores", () => {
  it.each(["ASESOR", "GERENTE", "TEAM_LEADER", "MARKETING", "BROKER"])("%s no da de alta (403)", async (role) => {
    sesion = { user: { id: "u1", role } };
    expect((await post({ name: "Onix" })).status).toBe(403);
    expect(create).not.toHaveBeenCalled();
  });

  it.each(["ADMIN", "DIRECTOR"])("%s da de alta; vacíos → null, autor = sesión", async (role) => {
    sesion = { user: { id: "u-admin", role } };
    create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "d1", ...data }));
    const res = await post({ name: "Onix", website: "", email: "", phone: "984 123" });
    expect(res.status).toBe(201);
    expect(create.mock.calls[0][0].data).toEqual({
      name: "Onix", website: null, email: null, phone: "984 123", createdById: "u-admin",
    });
  });

  it("nombre vacío → 400", async () => {
    sesion = { user: { id: "u1", role: "ADMIN" } };
    expect((await post({ name: "" })).status).toBe(400);
  });
});

describe("PATCH /api/desarrolladores/[id]", () => {
  it("ASESOR no edita (403)", async () => {
    expect((await patch("d1", { phone: "1" })).status).toBe(403);
    expect(update).not.toHaveBeenCalled();
  });
  it("DIRECTOR edita; vaciar el teléfono lo deja en null", async () => {
    sesion = { user: { id: "u1", role: "DIRECTOR" } };
    findFirst.mockResolvedValue({ id: "d1" });
    update.mockResolvedValue({ id: "d1", name: "Onix", website: null, email: null, phone: null });
    const res = await patch("d1", { phone: "" });
    expect(res.status).toBe(200);
    expect(update.mock.calls[0][0]).toMatchObject({ where: { id: "d1" }, data: { phone: null } });
  });
  it("inexistente o borrado → 404", async () => {
    sesion = { user: { id: "u1", role: "ADMIN" } };
    findFirst.mockResolvedValue(null);
    expect((await patch("nope", { phone: "1" })).status).toBe(404);
  });
});
