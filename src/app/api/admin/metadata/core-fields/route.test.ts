// GET/PUT /api/admin/metadata/core-fields: celda suelta, acción por grupo y usuarios activos por rol.
import { describe, it, expect, vi, beforeEach } from "vitest";

const session: { user: { id: string; role: string } } = { user: { id: "u1", role: "ADMIN" } };
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => Promise.resolve(session) }));

const permFindMany = vi.fn();
const permDeleteMany = vi.fn();
const permUpsert = vi.fn();
const userGroupBy = vi.fn();
const auditCreate = vi.fn();
const transaction = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    coreFieldPermission: {
      findMany: (...a: unknown[]) => permFindMany(...a),
      deleteMany: (...a: unknown[]) => permDeleteMany(...a),
      upsert: (...a: unknown[]) => permUpsert(...a),
    },
    user: { groupBy: (...a: unknown[]) => userGroupBy(...a) },
    auditLog: { create: (...a: unknown[]) => auditCreate(...a) },
    $transaction: (ops: unknown[]) => transaction(ops),
  },
}));

import { GET, PUT } from "./route";

const reqGet = () => ({ nextUrl: new URL("http://t/api/admin/metadata/core-fields?object=contact") }) as never;
const reqPut = (body: unknown) =>
  new Request("http://t/api/admin/metadata/core-fields", { method: "PUT", body: JSON.stringify(body) }) as never;

beforeEach(() => {
  for (const m of [permFindMany, permDeleteMany, permUpsert, userGroupBy, auditCreate, transaction]) m.mockReset();
  session.user.role = "ADMIN";
  permFindMany.mockResolvedValue([]);
  userGroupBy.mockResolvedValue([{ role: "ASESOR", _count: { _all: 4 } }]);
  permUpsert.mockImplementation((a: unknown) => ({ a }));
  transaction.mockResolvedValue([]);
  auditCreate.mockResolvedValue({});
});

describe("GET", () => {
  it("no admin → 403", async () => {
    session.user.role = "ASESOR";
    expect((await GET(reqGet())).status).toBe(403);
  });
  it("incluye el conteo de usuarios activos por rol", async () => {
    const res = await GET(reqGet());
    const { data } = await res.json();
    expect(data.usuariosActivos).toEqual({ ASESOR: 4 });
    expect(Array.isArray(data.fields)).toBe(true);
  });
});

describe("PUT", () => {
  it("una celda (forma original) sigue funcionando", async () => {
    const res = await PUT(reqPut({ object: "contact", fieldKey: "firstName", role: "ASESOR", access: "HIDDEN" }));
    expect(res.status).toBe(200);
    expect(permUpsert).toHaveBeenCalledTimes(1);
  });
  it("acción por grupo: un upsert por campo en una sola transacción", async () => {
    const res = await PUT(reqPut({ object: "contact", fieldKeys: ["firstName", "lastName", "phone"], role: "BROKER", access: "HIDDEN" }));
    expect(res.status).toBe(200);
    expect(permUpsert).toHaveBeenCalledTimes(3);
    expect(transaction).toHaveBeenCalledTimes(1);
  });
  it("EDIT borra las filas de todos los campos del grupo", async () => {
    await PUT(reqPut({ object: "contact", fieldKeys: ["firstName", "lastName"], role: "BROKER", access: "EDIT" }));
    expect(permDeleteMany.mock.calls[0][0].where).toEqual({ object: "contact", fieldKey: { in: ["firstName", "lastName"] }, role: "BROKER" });
  });
  it("campo desconocido → 400 y no escribe", async () => {
    const res = await PUT(reqPut({ object: "contact", fieldKeys: ["firstName", "noExiste"], role: "BROKER", access: "HIDDEN" }));
    expect(res.status).toBe(400);
    expect(transaction).not.toHaveBeenCalled();
  });
  it("sin fieldKey ni fieldKeys → 400", async () => {
    expect((await PUT(reqPut({ object: "contact", role: "BROKER", access: "HIDDEN" }))).status).toBe(400);
  });
  it("no admin → 403", async () => {
    session.user.role = "GERENTE";
    expect((await PUT(reqPut({ object: "contact", fieldKey: "firstName", role: "ASESOR", access: "READ" }))).status).toBe(403);
  });
});
