// GET/POST/PATCH /api/admin/metadata/fields: edición, opciones, permisos por rol y restaurar.
import { describe, it, expect, vi, beforeEach } from "vitest";

const session: { user: { id: string; role: string } } = { user: { id: "u1", role: "ADMIN" } };
let hasSession = true;
vi.mock("@/lib/auth/session", () => ({
  getServerSession: () => Promise.resolve(hasSession ? session : null),
}));
vi.mock("@/lib/metadata/registry", () => ({ invalidateMetadataCache: vi.fn() }));

const fieldFindMany = vi.fn();
const fieldFindUnique = vi.fn();
const fieldUpdate = vi.fn();
const optUpsert = vi.fn();
const optUpdateMany = vi.fn();
const permUpsert = vi.fn();
const auditCreate = vi.fn();
const transaction = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    customFieldDef: {
      findMany: (...a: unknown[]) => fieldFindMany(...a),
      findUnique: (...a: unknown[]) => fieldFindUnique(...a),
      update: (...a: unknown[]) => fieldUpdate(...a),
    },
    fieldOption: {
      upsert: (...a: unknown[]) => optUpsert(...a),
      updateMany: (...a: unknown[]) => optUpdateMany(...a),
    },
    fieldPermission: { upsert: (...a: unknown[]) => permUpsert(...a) },
    auditLog: { create: (...a: unknown[]) => auditCreate(...a) },
    $transaction: (ops: unknown[]) => transaction(ops),
  },
}));

import { GET, PATCH } from "./route";

const UUID = "9a8b7c6d-1e2f-4a3b-8c4d-5e6f7a8b9c0d";
const reqGet = (qs = "") => ({ nextUrl: new URL(`http://t/api/admin/metadata/fields${qs}`) }) as never;
const reqPatch = (body: unknown) =>
  new Request("http://t/api/admin/metadata/fields", { method: "PATCH", body: JSON.stringify(body) }) as never;

beforeEach(() => {
  for (const m of [fieldFindMany, fieldFindUnique, fieldUpdate, optUpsert, optUpdateMany, permUpsert, auditCreate, transaction]) m.mockReset();
  hasSession = true;
  session.user.role = "ADMIN";
  fieldFindMany.mockResolvedValue([]);
  fieldFindUnique.mockResolvedValue({ id: UUID, objectApiName: "contact", fieldType: "PICKLIST", isSystem: false });
  fieldUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: UUID, objectApiName: "contact", ...data }));
  optUpsert.mockImplementation((a: unknown) => ({ op: "upsert", a }));
  optUpdateMany.mockImplementation((a: unknown) => ({ op: "updateMany", a }));
  permUpsert.mockImplementation((a: unknown) => ({ op: "perm", a }));
  transaction.mockResolvedValue([]);
  auditCreate.mockResolvedValue({});
});

describe("GET", () => {
  it("sin sesión → 401", async () => {
    hasSession = false;
    expect((await GET(reqGet())).status).toBe(401);
  });
  it("por defecto trae solo los activos", async () => {
    await GET(reqGet("?object=contact"));
    expect(fieldFindMany.mock.calls[0][0].where).toEqual({ objectApiName: "contact", archivedAt: null });
  });
  it("?archived=1 trae solo los archivados", async () => {
    await GET(reqGet("?object=contact&archived=1"));
    expect(fieldFindMany.mock.calls[0][0].where.archivedAt).toEqual({ not: null });
  });
});

describe("PATCH", () => {
  it("no admin → 403", async () => {
    session.user.role = "GERENTE";
    expect((await PATCH(reqPatch({ id: UUID, label: "X" }))).status).toBe(403);
    expect(fieldUpdate).not.toHaveBeenCalled();
  });
  it("id inválido → 400", async () => {
    expect((await PATCH(reqPatch({ id: "no-uuid", label: "X" }))).status).toBe(400);
  });
  it("rol o acceso inválido → 400", async () => {
    expect((await PATCH(reqPatch({ id: UUID, permissions: [{ role: "REY", access: "EDIT" }] }))).status).toBe(400);
    expect((await PATCH(reqPatch({ id: UUID, permissions: [{ role: "ASESOR", access: "TODO" }] }))).status).toBe(400);
  });
  it("campo inexistente → 404; campo núcleo → 422", async () => {
    fieldFindUnique.mockResolvedValueOnce(null);
    expect((await PATCH(reqPatch({ id: UUID, label: "X" }))).status).toBe(404);
    fieldFindUnique.mockResolvedValueOnce({ id: UUID, isSystem: true, fieldType: "TEXT" });
    expect((await PATCH(reqPatch({ id: UUID, label: "X" }))).status).toBe(422);
  });
  it("edita etiqueta, ayuda y orden sin tocar tipo ni apiName", async () => {
    const res = await PATCH(reqPatch({ id: UUID, label: "Nueva", helpText: "Ayuda", order: 30 }));
    expect(res.status).toBe(200);
    const data = fieldUpdate.mock.calls[0][0].data;
    expect(data).toMatchObject({ label: "Nueva", helpText: "Ayuda", order: 30 });
    expect(data).not.toHaveProperty("apiName");
    expect(data).not.toHaveProperty("fieldType");
  });
  it("archive:false restaura (archivedAt null, activo)", async () => {
    await PATCH(reqPatch({ id: UUID, archive: false }));
    expect(fieldUpdate.mock.calls[0][0].data).toMatchObject({ archivedAt: null, isActive: true });
  });
  it("archive:true archiva", async () => {
    await PATCH(reqPatch({ id: UUID, archive: true }));
    const d = fieldUpdate.mock.calls[0][0].data;
    expect(d.archivedAt).toBeInstanceOf(Date);
    expect(d.isActive).toBe(false);
  });
  it("opciones: upsert de las enviadas y desactiva las que faltan", async () => {
    const res = await PATCH(reqPatch({ id: UUID, options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] }));
    expect(res.status).toBe(200);
    expect(optUpsert).toHaveBeenCalledTimes(2);
    expect(optUpsert.mock.calls[1][0].update).toMatchObject({ label: "B", order: 20, isActive: true });
    expect(optUpdateMany.mock.calls[0][0]).toEqual({
      where: { fieldId: UUID, value: { notIn: ["a", "b"] } },
      data: { isActive: false },
    });
    expect(transaction).toHaveBeenCalledTimes(1);
  });
  it("opciones en un campo que no es lista → 422", async () => {
    fieldFindUnique.mockResolvedValue({ id: UUID, objectApiName: "contact", fieldType: "TEXT", isSystem: false });
    expect((await PATCH(reqPatch({ id: UUID, options: [{ value: "a", label: "A" }] }))).status).toBe(422);
    expect(fieldUpdate).not.toHaveBeenCalled();
  });
  it("opciones vacías o repetidas → 422", async () => {
    expect((await PATCH(reqPatch({ id: UUID, options: [] }))).status).toBe(422);
    expect((await PATCH(reqPatch({ id: UUID, options: [{ value: "a", label: "A" }, { value: "a", label: "B" }] }))).status).toBe(422);
  });
  it("permisos por rol: upsert por cada rol", async () => {
    const res = await PATCH(reqPatch({ id: UUID, permissions: [{ role: "ASESOR", access: "HIDDEN" }, { role: "BROKER", access: "EDIT" }] }));
    expect(res.status).toBe(200);
    expect(permUpsert).toHaveBeenCalledTimes(2);
    expect(permUpsert.mock.calls[0][0]).toMatchObject({
      where: { fieldId_role: { fieldId: UUID, role: "ASESOR" } },
      update: { access: "HIDDEN" },
    });
  });
});
