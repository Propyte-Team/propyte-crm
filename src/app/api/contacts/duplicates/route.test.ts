// GET /api/contacts/duplicates (paginación y "No es duplicado") y POST .../revisados.
import { describe, it, expect, vi, beforeEach } from "vitest";

const session: { user: { id: string; role: string } } = { user: { id: "u1", role: "ADMIN" } };
let hasSession = true;
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => Promise.resolve(hasSession ? session : null) }));

const findGroups = vi.fn();
vi.mock("@/server/contacts-dedup", () => ({ findDuplicateGroups: () => findGroups() }));

const cfgFind = vi.fn();
const cfgUpsert = vi.fn();
const auditCreate = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    systemConfig: { findUnique: (...a: unknown[]) => cfgFind(...a), upsert: (...a: unknown[]) => cfgUpsert(...a) },
    auditLog: { create: (...a: unknown[]) => auditCreate(...a) },
  },
}));

import { GET } from "./route";
import { POST } from "./revisados/route";

const c = (id: string) => ({ id });
const grupo = (matchType: "strong" | "name", ...ids: string[]) => ({ matchType, contacts: ids.map(c) });
const reqGet = (qs = "") => ({ nextUrl: new URL(`http://t/api/contacts/duplicates${qs}`) }) as never;
const reqPost = (body: unknown) => new Request("http://t/x", { method: "POST", body: JSON.stringify(body) }) as never;

beforeEach(() => {
  for (const m of [findGroups, cfgFind, cfgUpsert, auditCreate]) m.mockReset();
  hasSession = true;
  session.user.role = "ADMIN";
  findGroups.mockResolvedValue([grupo("strong", "a", "b"), grupo("strong", "c", "d"), grupo("name", "e", "f")]);
  cfgFind.mockResolvedValue(null);
  auditCreate.mockResolvedValue({});
});

describe("GET duplicates", () => {
  it("sin sesión → 401; rol sin acceso → 403", async () => {
    hasSession = false;
    expect((await GET(reqGet())).status).toBe(401);
    hasSession = true;
    session.user.role = "ASESOR";
    expect((await GET(reqGet())).status).toBe(403);
  });
  it("sin parámetros devuelve todo, con key y totales", async () => {
    const { data, meta } = await (await GET(reqGet())).json();
    expect(data).toHaveLength(3);
    expect(data[0].key).toBe("a|b");
    expect(meta).toMatchObject({ total: 3, totalFuertes: 2, totalNombre: 1, hayMas: false });
  });
  it("pagina con limit/offset", async () => {
    const r1 = await (await GET(reqGet("?limit=2"))).json();
    expect(r1.data).toHaveLength(2);
    expect(r1.meta.hayMas).toBe(true);
    const r2 = await (await GET(reqGet("?limit=2&offset=2"))).json();
    expect(r2.data).toHaveLength(1);
    expect(r2.meta.hayMas).toBe(false);
  });
  it("filtra por tipo", async () => {
    const { data, meta } = await (await GET(reqGet("?tipo=name"))).json();
    expect(data).toHaveLength(1);
    expect(meta.total).toBe(3);
    expect(meta.filtrados).toBe(1);
  });
  it("oculta los grupos marcados como revisados", async () => {
    cfgFind.mockResolvedValue({ value: ["c|d"] });
    const { data, meta } = await (await GET(reqGet())).json();
    expect(data.map((g: { key: string }) => g.key)).toEqual(["a|b", "e|f"]);
    expect(meta.total).toBe(2);
  });
  it("un grupo que creció vuelve a aparecer", async () => {
    cfgFind.mockResolvedValue({ value: ["a|b"] });
    findGroups.mockResolvedValue([grupo("strong", "a", "b", "z")]);
    expect((await (await GET(reqGet())).json()).data).toHaveLength(1);
  });
});

describe("POST duplicates/revisados", () => {
  it("guarda la firma del grupo", async () => {
    const res = await POST(reqPost({ ids: ["b", "a"] }));
    expect(res.status).toBe(200);
    expect(cfgUpsert.mock.calls[0][0].update.value).toEqual(["a|b"]);
  });
  it("no duplica una firma ya guardada", async () => {
    cfgFind.mockResolvedValue({ value: ["a|b"] });
    await POST(reqPost({ ids: ["a", "b"] }));
    expect(cfgUpsert).not.toHaveBeenCalled();
  });
  it("menos de 2 ids → 400; sin permiso → 403", async () => {
    expect((await POST(reqPost({ ids: ["a"] }))).status).toBe(400);
    session.user.role = "GERENTE";
    expect((await POST(reqPost({ ids: ["a", "b"] }))).status).toBe(403);
  });
});
