// PUT /api/admin/users/[id]/brands (2026-10-12): solo ADMIN, reemplaza el conjunto completo,
// valida con zod y solo acepta marcas vivas.
import { describe, it, expect, vi, beforeEach } from "vitest";

const session: { user: { id: string; role: string } } = { user: { id: "adm-1", role: "ADMIN" } };
let hasSession = true;
vi.mock("@/lib/auth/session", () => ({
  getServerSession: () => Promise.resolve(hasSession ? session : null),
}));

const userFindFirst = vi.fn();
const brandFindMany = vi.fn();
const accessFindMany = vi.fn();
const accessDeleteMany = vi.fn();
const accessCreateMany = vi.fn();
const transaction = vi.fn();
const auditCreate = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    user: { findFirst: (...a: unknown[]) => userFindFirst(...a) },
    brand: { findMany: (...a: unknown[]) => brandFindMany(...a) },
    userBrandAccess: {
      findMany: (...a: unknown[]) => accessFindMany(...a),
      deleteMany: (...a: unknown[]) => accessDeleteMany(...a),
      createMany: (...a: unknown[]) => accessCreateMany(...a),
    },
    $transaction: (...a: unknown[]) => transaction(...a),
    auditLog: { create: (...a: unknown[]) => auditCreate(...a) },
  },
}));

import { PUT } from "./route";

const ctx = { params: Promise.resolve({ id: "u-9" }) };
function put(body: unknown) {
  return PUT(new Request("http://t/api/admin/users/u-9/brands", { method: "PUT", body: JSON.stringify(body) }) as never, ctx);
}

beforeEach(() => {
  for (const m of [userFindFirst, brandFindMany, accessFindMany, accessDeleteMany, accessCreateMany, transaction, auditCreate]) {
    m.mockReset();
  }
  hasSession = true;
  session.user.role = "ADMIN";
  userFindFirst.mockResolvedValue({ id: "u-9", name: "Ana", email: "ana@x.com" });
  brandFindMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) =>
    where.id.in.filter((id) => id !== "b-borrada").map((id) => ({ id })),
  );
  accessFindMany.mockResolvedValue([]);
  accessDeleteMany.mockReturnValue("op-delete");
  accessCreateMany.mockReturnValue("op-create");
  transaction.mockResolvedValue([]);
  auditCreate.mockResolvedValue({});
});

describe("PUT /api/admin/users/[id]/brands — permisos", () => {
  it("sin sesión → 403", async () => {
    hasSession = false;
    expect((await put({ brandIds: ["b-def"] })).status).toBe(403);
    expect(transaction).not.toHaveBeenCalled();
  });

  for (const role of ["DIRECTOR", "GERENTE", "MARKETING", "ASESOR_SR"]) {
    it(`${role} → 403 (está sujeto a sus propios interruptores; no se los puede prender)`, async () => {
      session.user.role = role;
      expect((await put({ brandIds: ["b-def", "b-yax"] })).status).toBe(403);
      expect(transaction).not.toHaveBeenCalled();
    });
  }
});

describe("PUT /api/admin/users/[id]/brands — validación", () => {
  it("conjunto vacío → 400 (vacío se leería como 'solo la predeterminada')", async () => {
    const res = await put({ brandIds: [] });
    expect(res.status).toBe(400);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("sin brandIds, o con claves de más → 400", async () => {
    expect((await put({})).status).toBe(400);
    expect((await put({ brandIds: ["b-def"], userId: "otro" })).status).toBe(400);
    expect((await put(null)).status).toBe(400);
  });

  it("una marca borrada o inexistente → 400 y no escribe", async () => {
    const res = await put({ brandIds: ["b-def", "b-borrada"] });
    expect(res.status).toBe(400);
    expect(transaction).not.toHaveBeenCalled();
    expect(brandFindMany.mock.calls[0][0].where).toEqual({ id: { in: ["b-def", "b-borrada"] }, deletedAt: null });
  });

  it("usuario inexistente o eliminado → 404", async () => {
    userFindFirst.mockResolvedValue(null);
    expect((await put({ brandIds: ["b-def"] })).status).toBe(404);
    expect(userFindFirst.mock.calls[0][0].where).toEqual({ id: "u-9", deletedAt: null });
  });
});

describe("PUT /api/admin/users/[id]/brands — reemplazo", () => {
  it("borra el conjunto anterior y escribe el nuevo COMPLETO (con la predeterminada), en una transacción", async () => {
    const res = await put({ brandIds: ["b-def", "b-yax", "b-yax"] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { userId: "u-9", brandIds: ["b-def", "b-yax"] } });
    expect(accessDeleteMany).toHaveBeenCalledWith({ where: { userId: "u-9" } });
    expect(accessCreateMany).toHaveBeenCalledWith({
      data: [
        { userId: "u-9", brandId: "b-def" },
        { userId: "u-9", brandId: "b-yax" },
      ],
    });
    expect(transaction).toHaveBeenCalledWith(["op-delete", "op-create"]);
  });

  it("deja rastro en AuditLog con el antes (null = sin filas) y el después", async () => {
    await put({ brandIds: ["b-yax"] });
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "adm-1",
        action: "UPDATE",
        entity: "User",
        entityId: "u-9",
        changes: expect.objectContaining({ field: "brandAccess", from: null, to: ["b-yax"] }),
      }),
    });
  });

  it("migración sin aplicar (P2021) → 503 con un mensaje que lo dice", async () => {
    accessFindMany.mockRejectedValue(Object.assign(new Error("no table"), { code: "P2021" }));
    const res = await put({ brandIds: ["b-def"] });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/migración/);
  });
});
