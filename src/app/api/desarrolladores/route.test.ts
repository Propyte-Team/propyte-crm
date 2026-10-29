import { describe, it, expect, vi, beforeEach } from "vitest";

// #872/#949 — API de Empresas (antes Desarrolladores): todos consultan; ADMIN, DIRECTOR y GERENTE
// escriben. Cada empresa tiene tipo (#949).

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

const get = (qs = "") => GET(new Request(`http://x/api/desarrolladores${qs}`) as never);
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
    expect((await get()).status).toBe(401);
  });
  it("cualquier rol consulta; el asesor no puede crear (puedeEditar = false)", async () => {
    findMany.mockResolvedValue([{ id: "d1", name: "Onix", type: "DESARROLLADORA", website: null, email: null, phone: null }]);
    const res = await get();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveLength(1);
    expect(json.puedeEditar).toBe(false);
    expect(findMany.mock.calls[0][0].where).toEqual({ deletedAt: null });
    expect(findMany.mock.calls[0][0].select.type).toBe(true);
  });
  it.each(["ADMIN", "DIRECTOR", "GERENTE"])("%s: puedeEditar = true", async (role) => {
    sesion = { user: { id: "u1", role } };
    findMany.mockResolvedValue([]);
    expect((await (await get()).json()).puedeEditar).toBe(true);
  });
  it("?tipo= filtra por tipo de empresa", async () => {
    findMany.mockResolvedValue([]);
    await get("?tipo=INMOBILIARIA");
    expect(findMany.mock.calls[0][0].where).toEqual({ deletedAt: null, type: "INMOBILIARIA" });
  });
  it("?tipo=SIN_TIPO busca las que no tienen tipo", async () => {
    findMany.mockResolvedValue([]);
    await get("?tipo=SIN_TIPO");
    expect(findMany.mock.calls[0][0].where).toEqual({ deletedAt: null, type: null });
  });
  it("?tipo= desconocido se ignora (lista completa)", async () => {
    findMany.mockResolvedValue([]);
    await get("?tipo=NAVIERA");
    expect(findMany.mock.calls[0][0].where).toEqual({ deletedAt: null });
  });
  it("tabla aún no creada (P2021) → lista vacía, no error", async () => {
    findMany.mockRejectedValue(Object.assign(new Error("no table"), { code: "P2021" }));
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: [] });
  });
});

describe("POST /api/desarrolladores", () => {
  it.each(["ASESOR", "ASESOR_SR", "ASESOR_JR", "TEAM_LEADER", "MARKETING", "BROKER"])("%s no da de alta (403)", async (role) => {
    sesion = { user: { id: "u1", role } };
    expect((await post({ name: "Onix", type: "DESARROLLADORA" })).status).toBe(403);
    expect(create).not.toHaveBeenCalled();
  });

  it.each(["ADMIN", "DIRECTOR", "GERENTE"])("%s da de alta; vacíos → null, autor = sesión", async (role) => {
    sesion = { user: { id: "u-admin", role } };
    create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "d1", ...data }));
    const res = await post({ name: "Onix", type: "INMOBILIARIA", website: "", email: "", phone: "984 123" });
    expect(res.status).toBe(201);
    expect(create.mock.calls[0][0].data).toEqual({
      name: "Onix", type: "INMOBILIARIA", website: null, email: null, phone: "984 123", createdById: "u-admin",
    });
  });

  it("nombre vacío → 400", async () => {
    sesion = { user: { id: "u1", role: "ADMIN" } };
    expect((await post({ name: "", type: "PROVEEDOR" })).status).toBe(400);
  });

  it("sin tipo → 400 (el tipo es obligatorio al crear)", async () => {
    sesion = { user: { id: "u1", role: "ADMIN" } };
    expect((await post({ name: "Onix" })).status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it("tipo que no está en la lista → 400", async () => {
    sesion = { user: { id: "u1", role: "ADMIN" } };
    expect((await post({ name: "Onix", type: "NAVIERA" })).status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/desarrolladores/[id]", () => {
  it("ASESOR no edita (403)", async () => {
    expect((await patch("d1", { phone: "1" })).status).toBe(403);
    expect(update).not.toHaveBeenCalled();
  });
  it("GERENTE cambia el tipo", async () => {
    sesion = { user: { id: "u1", role: "GERENTE" } };
    findFirst.mockResolvedValue({ id: "d1" });
    update.mockResolvedValue({ id: "d1", name: "Onix", type: "PROVEEDOR", website: null, email: null, phone: null });
    const res = await patch("d1", { type: "PROVEEDOR" });
    expect(res.status).toBe(200);
    expect(update.mock.calls[0][0].data).toEqual({ type: "PROVEEDOR" });
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
