// Filtro por marca en las server actions de contactos (2026-10-12, spec marcas-visibilidad).
// Se prueba que la marca va con AND encima del alcance por rol y que un contacto de una marca
// que el usuario no ve se trata como inexistente.
import { describe, it, expect, vi, beforeEach } from "vitest";

const contactFindMany = vi.fn();
const contactCount = vi.fn();
const contactFindFirst = vi.fn();
const userFindMany = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    contact: {
      findMany: (...a: unknown[]) => contactFindMany(...a),
      count: (...a: unknown[]) => contactCount(...a),
      findFirst: (...a: unknown[]) => contactFindFirst(...a),
    },
    user: { findMany: (...a: unknown[]) => userFindMany(...a) },
  },
}));

let sesion: { user: { id: string; role: string; plaza: string } } | null = null;
vi.mock("@/lib/auth/session", () => ({ getServerSession: async () => sesion }));
vi.mock("@/lib/webhooks/dispatcher", () => ({ dispatchWebhook: async () => undefined }));

const getVisibleBrands = vi.fn();
vi.mock("@/lib/brands/user-access", () => ({ getVisibleBrands: (...a: unknown[]) => getVisibleBrands(...a) }));

import { getContacts, getContact, getContactAccessInfo } from "./contacts";

const SOLO_PROPYTE = { brandIds: ["b-def"], includesDefault: true };
const CON_YAXNAH = { brandIds: ["b-def", "b-yax"], includesDefault: true };
const marcaDe = (userId: string, brandIds = ["b-def"]) => ({
  OR: [
    { assignedToId: userId },
    { brands: { some: { brandId: { in: brandIds } } } },
    { brands: { none: {} } },
  ],
});

const GERENTE = { user: { id: "ger-1", role: "GERENTE", plaza: "CANCUN" } };
const ASESOR = { user: { id: "ase-1", role: "ASESOR_SR", plaza: "CANCUN" } };
const DIRECTOR = { user: { id: "dir-1", role: "DIRECTOR", plaza: "CANCUN" } };

beforeEach(() => {
  for (const m of [contactFindMany, contactCount, contactFindFirst, userFindMany, getVisibleBrands]) m.mockReset();
  contactFindMany.mockResolvedValue([]);
  contactCount.mockResolvedValue(0);
  userFindMany.mockResolvedValue([{ id: "ase-1" }, { id: "ase-2" }]);
  getVisibleBrands.mockResolvedValue(SOLO_PROPYTE);
  sesion = GERENTE;
});

describe("getContacts", () => {
  it("GERENTE: alcance de plaza (OR) intacto y la marca en AND", async () => {
    await getContacts({});
    const where = contactFindMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([{ assignedToId: { in: ["ase-1", "ase-2"] } }, { assignedToId: null }]);
    expect(where.AND).toEqual([marcaDe("ger-1")]);
    // El conteo usa el MISMO where (si no, la paginación contaría contactos ocultos).
    expect(contactCount.mock.calls[0][0].where).toBe(where);
    expect(getVisibleBrands).toHaveBeenCalledWith(GERENTE.user);
  });

  it("con búsqueda: la marca y la búsqueda conviven en AND (ninguna pisa a la otra)", async () => {
    await getContacts({ search: "ana" });
    const where = contactFindMany.mock.calls[0][0].where;
    expect(where.AND).toHaveLength(2);
    expect(where.AND[0]).toEqual(marcaDe("ger-1"));
    expect(where.AND[1].OR).toEqual(expect.arrayContaining([{ firstName: { contains: "ana", mode: "insensitive" } }]));
  });

  it("DIRECTOR (acceso total por rol) también se recorta por marca", async () => {
    sesion = DIRECTOR;
    getVisibleBrands.mockResolvedValue(CON_YAXNAH);
    await getContacts({});
    expect(contactFindMany.mock.calls[0][0].where.AND).toEqual([marcaDe("dir-1", ["b-def", "b-yax"])]);
  });

  it("ADMIN (ALL): sin término de marca", async () => {
    sesion = { user: { id: "adm-1", role: "ADMIN", plaza: "CANCUN" } };
    getVisibleBrands.mockResolvedValue("ALL");
    await getContacts({});
    expect(contactFindMany.mock.calls[0][0].where.AND).toBeUndefined();
  });
});

describe("getContact (ficha)", () => {
  const contactoYax = { id: "k1", assignedToId: "ase-2", brands: [{ brandId: "b-yax" }] };

  it("trae las marcas del contacto en el include", async () => {
    contactFindFirst.mockResolvedValue({ id: "k1", assignedToId: null, brands: [] });
    await getContact("k1");
    expect(contactFindFirst.mock.calls[0][0].include.brands).toEqual({ select: { brandId: true } });
  });

  it("contacto de Yaxnáh y usuario sin Yaxnáh → 'Contacto no encontrado' (la página da 404)", async () => {
    contactFindFirst.mockResolvedValue(contactoYax);
    await expect(getContact("k1")).rejects.toThrow("Contacto no encontrado");
  });

  it("con Yaxnáh prendida → lo devuelve", async () => {
    getVisibleBrands.mockResolvedValue(CON_YAXNAH);
    contactFindFirst.mockResolvedValue(contactoYax);
    await expect(getContact("k1")).resolves.toMatchObject({ id: "k1" });
  });

  it("asignado a mí aunque sea de Yaxnáh → lo devuelve", async () => {
    sesion = ASESOR;
    contactFindFirst.mockResolvedValue({ ...contactoYax, assignedToId: "ase-1" });
    await expect(getContact("k1")).resolves.toMatchObject({ id: "k1" });
  });

  it("la marca no amplía el rol: asesor CON Yaxnáh y contacto de otro → sigue sin acceso", async () => {
    sesion = ASESOR;
    getVisibleBrands.mockResolvedValue(CON_YAXNAH);
    contactFindFirst.mockResolvedValue(contactoYax);
    await expect(getContact("k1")).rejects.toThrow("No tienes acceso a este contacto");
  });
});

describe("getContactAccessInfo (cronología, periodos, mensajes, vínculos, llamadas)", () => {
  const fila = (over: Record<string, unknown> = {}) => ({
    id: "k1",
    assignedToId: "ase-2",
    createdAt: new Date("2026-10-01"),
    leadSource: "WHATSAPP",
    contactStatus: "NUEVO",
    brands: [{ brandId: "b-yax" }],
    ...over,
  });

  it("fuera de marca → not_found (no forbidden: la existencia es el dato que se esconde)", async () => {
    contactFindFirst.mockResolvedValue(fila());
    expect(await getContactAccessInfo("k1", GERENTE)).toEqual({ ok: false, reason: "not_found" });
    expect(contactFindFirst.mock.calls[0][0].select.brands).toEqual({ select: { brandId: true } });
  });

  it("con la marca → ok, y las marcas no salen en el contacto devuelto", async () => {
    getVisibleBrands.mockResolvedValue(CON_YAXNAH);
    contactFindFirst.mockResolvedValue(fila());
    const r = await getContactAccessInfo("k1", GERENTE);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.contact).not.toHaveProperty("brands");
  });

  it("contacto sin filas (Propyte) y usuario sin filas → ok", async () => {
    contactFindFirst.mockResolvedValue(fila({ brands: [] }));
    expect((await getContactAccessInfo("k1", GERENTE)).ok).toBe(true);
  });

  it("el rol se evalúa primero: asesor sobre contacto ajeno sigue siendo forbidden", async () => {
    contactFindFirst.mockResolvedValue(fila({ brands: [] }));
    expect(await getContactAccessInfo("k1", ASESOR)).toEqual({ ok: false, reason: "forbidden" });
  });
});
