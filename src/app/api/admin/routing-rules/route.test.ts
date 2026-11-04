// GET/POST /api/admin/routing-rules: permisos por rol, validación de targets y duplicados.
import { describe, it, expect, vi, beforeEach } from "vitest";

const session: { user: { id: string; role: string } } = { user: { id: "u1", role: "ADMIN" } };
let hasSession = true;
vi.mock("@/lib/auth/session", () => ({
  getServerSession: () => Promise.resolve(hasSession ? session : null),
}));

const findMany = vi.fn();
const findFirst = vi.fn();
const create = vi.fn();
const update = vi.fn();
const auditCreate = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    routingRule: {
      findMany: (...a: unknown[]) => findMany(...a),
      findFirst: (...a: unknown[]) => findFirst(...a),
      create: (...a: unknown[]) => create(...a),
      update: (...a: unknown[]) => update(...a),
    },
    auditLog: { create: (...a: unknown[]) => auditCreate(...a) },
  },
}));

import { GET, POST } from "./route";
import { PATCH, DELETE } from "./[id]/route";

const UUID = "9a8b7c6d-1e2f-4a3b-8c4d-5e6f7a8b9c0d";

function req(body: unknown, method = "POST") {
  return new Request("http://t/api/admin/routing-rules", { method, body: JSON.stringify(body) }) as never;
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

const VALID = {
  name: "Leads de Meta a Tulum",
  strategy: "ROUND_ROBIN",
  conditions: { all: [{ field: "contact.leadSource", op: "eq", value: "META_ADS" }] },
  targets: { roles: ["ASESOR"], plaza: "TULUM" },
};

beforeEach(() => {
  for (const m of [findMany, findFirst, create, update, auditCreate]) m.mockReset();
  hasSession = true;
  session.user.role = "ADMIN";
  findMany.mockResolvedValue([]);
  findFirst.mockResolvedValue(null);
  create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "r1", ...data }));
  update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "r1", ...data }));
  auditCreate.mockResolvedValue({});
});

describe("GET /api/admin/routing-rules", () => {
  it("sin sesión → 403", async () => {
    hasSession = false;
    expect((await GET()).status).toBe(403);
    expect(findMany).not.toHaveBeenCalled();
  });
  it("ASESOR → 403", async () => {
    session.user.role = "ASESOR";
    expect((await GET()).status).toBe(403);
  });
  it("GERENTE lee las reglas no borradas, por prioridad", async () => {
    session.user.role = "GERENTE";
    findMany.mockResolvedValue([{ id: "r1" }]);
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual([{ id: "r1" }]);
    expect(findMany.mock.calls[0][0]).toMatchObject({ where: { deletedAt: null } });
  });
});

describe("POST /api/admin/routing-rules", () => {
  it("GERENTE no crea → 403", async () => {
    session.user.role = "GERENTE";
    expect((await POST(req(VALID))).status).toBe(403);
    expect(create).not.toHaveBeenCalled();
  });
  it("crea activa por defecto con prioridad 100", async () => {
    const res = await POST(req(VALID));
    expect(res.status).toBe(201);
    expect(create.mock.calls[0][0].data).toMatchObject({
      name: VALID.name, isActive: true, priority: 100, strategy: "ROUND_ROBIN",
      targets: { roles: ["ASESOR"], plaza: "TULUM" },
    });
    expect(auditCreate).toHaveBeenCalled();
  });
  it("rechaza targets con claves que el motor no lee", async () => {
    const res = await POST(req({ ...VALID, targets: { teamId: "x" } }));
    expect(res.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });
  it("rechaza estrategia desconocida y condiciones mal formadas", async () => {
    expect((await POST(req({ ...VALID, strategy: "RANDOM" }))).status).toBe(400);
    expect((await POST(req({ ...VALID, conditions: { all: [{ field: "x" }] } }))).status).toBe(400);
  });
  it("nombre repetido → 409", async () => {
    findFirst.mockResolvedValue({ id: "otra" });
    expect((await POST(req(VALID))).status).toBe(409);
    expect(create).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/admin/routing-rules/[id]", () => {
  it("GERENTE puede desactivar", async () => {
    session.user.role = "GERENTE";
    findFirst.mockResolvedValue({ id: UUID });
    const res = await PATCH(req({ isActive: false }, "PATCH"), params(UUID));
    expect(res.status).toBe(200);
    expect(update.mock.calls[0][0]).toEqual({ where: { id: UUID }, data: { isActive: false } });
  });
  it("regla borrada o inexistente → 404", async () => {
    findFirst.mockResolvedValue(null);
    expect((await PATCH(req({ isActive: false }, "PATCH"), params(UUID))).status).toBe(404);
  });
  it("ASESOR → 403", async () => {
    session.user.role = "ASESOR";
    expect((await PATCH(req({ isActive: false }, "PATCH"), params(UUID))).status).toBe(403);
  });
});

describe("DELETE /api/admin/routing-rules/[id]", () => {
  it("GERENTE no borra → 403", async () => {
    session.user.role = "GERENTE";
    expect((await DELETE(req(null, "DELETE"), params(UUID))).status).toBe(403);
  });
  it("borra en blando y la desactiva", async () => {
    findFirst.mockResolvedValue({ id: UUID, name: "x" });
    const res = await DELETE(req(null, "DELETE"), params(UUID));
    expect(res.status).toBe(200);
    const data = update.mock.calls[0][0].data;
    expect(data.isActive).toBe(false);
    expect(data.deletedAt).toBeInstanceOf(Date);
  });
});
