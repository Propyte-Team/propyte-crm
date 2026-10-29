import { describe, it, expect, vi, beforeEach } from "vitest";

// #949 — Contactos de una empresa (decisión de sistemas@, 2026-10-29):
// - todos ven a TODOS los contactos de la empresa (nombre, tipo, asesor);
// - teléfono, email y liga solo de los que quien mira puede abrir;
// - asignar/quitar: quien puede abrir la ficha de ESE contacto y tiene «Empresa» editable.

const empresaFindFirst = vi.fn();
const contactFindMany = vi.fn();
const contactCount = vi.fn();
const contactUpdate = vi.fn();
const contactUpdateMany = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    developerPartner: { findFirst: (...a: unknown[]) => empresaFindFirst(...a) },
    contact: {
      findMany: (...a: unknown[]) => contactFindMany(...a),
      count: (...a: unknown[]) => contactCount(...a),
    },
  },
}));

let sesion: { user: { id: string; role: string; plaza: string } } | null = null;
vi.mock("@/lib/auth/session", () => ({ getServerSession: async () => sesion }));

const withChangeSource = vi.fn();
vi.mock("@/lib/audit/change-context", () => ({
  withChangeSource: (opts: unknown, fn: (tx: unknown) => unknown) => {
    withChangeSource(opts);
    return fn({
      contact: {
        update: (...a: unknown[]) => contactUpdate(...a),
        updateMany: (...a: unknown[]) => contactUpdateMany(...a),
      },
    });
  },
}));

let bloqueados = new Set<string>();
vi.mock("@/lib/metadata/core-fields", () => ({
  resolveCoreFieldAccess: async () => ({}),
  nonEditableKeys: () => bloqueados,
}));

let marcas: unknown = "ALL";
vi.mock("@/lib/brands/user-access", () => ({ getVisibleBrands: async () => marcas }));

const getContactAccessInfo = vi.fn();
vi.mock("@/server/contacts", () => ({ getContactAccessInfo: (...a: unknown[]) => getContactAccessInfo(...a) }));

// El alcance real: con prisma.user mockeado no hace falta, el asesor no consulta usuarios.
import { GET, POST, DELETE } from "./route";

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const get = (id = "e1") => GET(new Request(`http://x/api/desarrolladores/${id}/contactos`) as never, params(id));
const post = (body: unknown, id = "e1") =>
  POST(
    new Request(`http://x/api/desarrolladores/${id}/contactos`, { method: "POST", body: JSON.stringify(body) }) as never,
    params(id),
  );
const del = (contactId: string | null, id = "e1") =>
  DELETE(
    new Request(`http://x/api/desarrolladores/${id}/contactos${contactId ? `?contactId=${contactId}` : ""}`, {
      method: "DELETE",
    }) as never,
    params(id),
  );

const fila = (id: string, assignedToId: string | null, extra: Record<string, unknown> = {}) => ({
  id,
  firstName: "Ana",
  lastName: id,
  contactType: "BROKER_EXTERNO",
  email: `${id}@x.mx`,
  phone: "9981112233",
  assignedToId,
  assignedTo: assignedToId ? { name: `Asesor ${assignedToId}` } : null,
  ...extra,
});

beforeEach(() => {
  for (const m of [empresaFindFirst, contactFindMany, contactCount, contactUpdate, contactUpdateMany, getContactAccessInfo, withChangeSource]) {
    m.mockReset();
  }
  sesion = { user: { id: "ase-1", role: "ASESOR", plaza: "PDC" } };
  bloqueados = new Set();
  marcas = "ALL";
  empresaFindFirst.mockImplementation(async ({ where }: { where: { id: string } }) => (where.id === "e1" ? { id: "e1" } : null));
  getContactAccessInfo.mockResolvedValue({ ok: true, contact: { id: "c1" } });
});

describe("GET /api/desarrolladores/[id]/contactos", () => {
  it("sin sesión → 401", async () => {
    sesion = null;
    expect((await get()).status).toBe(401);
  });

  it("empresa inexistente o borrada → 404", async () => {
    expect((await get("nope")).status).toBe(404);
  });

  it("un asesor ve a TODOS los contactos de la empresa, pero solo los suyos con datos y liga", async () => {
    contactFindMany.mockResolvedValue([fila("mio", "ase-1"), fila("ajeno", "ase-9"), fila("huerfano", null)]);
    contactCount.mockResolvedValue(3);
    const res = await get();
    expect(res.status).toBe(200);
    const json = await res.json();
    // La consulta no filtra por dueño: solo por empresa y borrado.
    expect(contactFindMany.mock.calls[0][0].where).toEqual({ developerPartnerId: "e1", deletedAt: null });
    expect(json.data.map((c: { id: string }) => c.id)).toEqual(["mio", "ajeno", "huerfano"]);
    const [mio, ajeno, huerfano] = json.data;
    expect(mio).toMatchObject({ puedeAbrir: true, phone: "9981112233", email: "mio@x.mx", asesor: "Asesor ase-1" });
    expect(ajeno).toMatchObject({ puedeAbrir: false, phone: null, email: null, asesor: "Asesor ase-9", nombre: "Ana ajeno" });
    expect(huerfano).toMatchObject({ puedeAbrir: false, phone: null, email: null, asesor: null });
    expect(json.puedeAsignar).toBe(true);
    expect(json.noListados).toBe(0);
  });

  it("DIRECTOR abre todos", async () => {
    sesion = { user: { id: "dir", role: "DIRECTOR", plaza: "PDC" } };
    contactFindMany.mockResolvedValue([fila("a", "ase-9"), fila("b", null)]);
    contactCount.mockResolvedValue(2);
    const json = await (await get()).json();
    expect(json.data.every((c: { puedeAbrir: boolean }) => c.puedeAbrir)).toBe(true);
  });

  it("la visibilidad por MARCA no se relaja: se filtra en la consulta y los de fuera solo se cuentan", async () => {
    marcas = { brandIds: ["b1"], includesDefault: false };
    contactFindMany.mockResolvedValue([fila("mio", "ase-1")]);
    contactCount.mockResolvedValue(3);
    const json = await (await get()).json();
    expect(contactFindMany.mock.calls[0][0].where.AND).toHaveLength(1);
    expect(contactCount.mock.calls[0][0].where).toEqual({ developerPartnerId: "e1", deletedAt: null });
    expect(json.noListados).toBe(2);
  });

  it("teléfono vacío (centinela \"\") sale como null", async () => {
    contactFindMany.mockResolvedValue([fila("mio", "ase-1", { phone: "" })]);
    contactCount.mockResolvedValue(1);
    expect((await (await get()).json()).data[0].phone).toBeNull();
  });

  it("rol con «Empresa» en solo lectura: ve la lista, puedeAsignar = false", async () => {
    bloqueados = new Set(["developerPartnerId"]);
    contactFindMany.mockResolvedValue([]);
    contactCount.mockResolvedValue(0);
    expect((await (await get()).json()).puedeAsignar).toBe(false);
  });
});

describe("POST /api/desarrolladores/[id]/contactos (asignar)", () => {
  it("asesor asigna SU contacto: guarda la empresa, firmado en la cronología", async () => {
    contactUpdate.mockResolvedValue(fila("c1", "ase-1"));
    const res = await post({ contactId: "c1" });
    expect(res.status).toBe(200);
    expect(getContactAccessInfo).toHaveBeenCalledWith("c1", sesion);
    expect(contactUpdate.mock.calls[0][0]).toMatchObject({ where: { id: "c1" }, data: { developerPartnerId: "e1" } });
    expect(withChangeSource).toHaveBeenCalledWith({ source: "ui", actorId: "ase-1" });
    expect((await res.json()).data).toMatchObject({ id: "c1", puedeAbrir: true });
  });

  it("contacto ajeno → 403 y no guarda", async () => {
    getContactAccessInfo.mockResolvedValue({ ok: false, reason: "forbidden" });
    const res = await post({ contactId: "c9" });
    expect(res.status).toBe(403);
    expect(contactUpdate).not.toHaveBeenCalled();
  });

  it("contacto inexistente o de otra marca → 404", async () => {
    getContactAccessInfo.mockResolvedValue({ ok: false, reason: "not_found" });
    expect((await post({ contactId: "c9" })).status).toBe(404);
    expect(contactUpdate).not.toHaveBeenCalled();
  });

  it("rol con «Empresa» en solo lectura → 403", async () => {
    bloqueados = new Set(["developerPartnerId"]);
    expect((await post({ contactId: "c1" })).status).toBe(403);
    expect(contactUpdate).not.toHaveBeenCalled();
  });

  it("empresa inexistente → 404", async () => {
    expect((await post({ contactId: "c1" }, "nope")).status).toBe(404);
    expect(contactUpdate).not.toHaveBeenCalled();
  });

  it("sin contactId → 400", async () => {
    expect((await post({})).status).toBe(400);
  });
});

describe("DELETE /api/desarrolladores/[id]/contactos (quitar)", () => {
  it("quita la liga solo si el contacto es de ESTA empresa", async () => {
    contactUpdateMany.mockResolvedValue({ count: 1 });
    const res = await del("c1");
    expect(res.status).toBe(200);
    expect(contactUpdateMany.mock.calls[0][0]).toEqual({
      where: { id: "c1", developerPartnerId: "e1", deletedAt: null },
      data: { developerPartnerId: null },
    });
  });

  it("si ya no estaba en la empresa → 409", async () => {
    contactUpdateMany.mockResolvedValue({ count: 0 });
    expect((await del("c1")).status).toBe(409);
  });

  it("contacto ajeno → 403 y no toca nada", async () => {
    getContactAccessInfo.mockResolvedValue({ ok: false, reason: "forbidden" });
    expect((await del("c9")).status).toBe(403);
    expect(contactUpdateMany).not.toHaveBeenCalled();
  });

  it("sin contactId → 400", async () => {
    expect((await del(null)).status).toBe(400);
  });
});
