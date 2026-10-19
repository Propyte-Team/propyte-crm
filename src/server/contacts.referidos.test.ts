// #907: la ficha del broker lista sus referidos y la del referido dice quién lo trajo. Se prueba
// que solo se nombran los que quien mira puede abrir (rol + marca, las mismas puertas que la
// ficha), que los demás solo se cuentan, y que nada crudo (dueños, marcas) llega al cliente.
import { describe, it, expect, vi, beforeEach } from "vitest";

const contactFindFirst = vi.fn();
const userFindMany = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    contact: { findFirst: (...a: unknown[]) => contactFindFirst(...a) },
    user: { findMany: (...a: unknown[]) => userFindMany(...a) },
  },
}));

let sesion: { user: { id: string; role: string; plaza: string } } | null = null;
vi.mock("@/lib/auth/session", () => ({ getServerSession: async () => sesion }));
vi.mock("@/lib/webhooks/dispatcher", () => ({ dispatchWebhook: async () => undefined }));

const getVisibleBrands = vi.fn();
vi.mock("@/lib/brands/user-access", () => ({ getVisibleBrands: (...a: unknown[]) => getVisibleBrands(...a) }));

import { getContact } from "./contacts";

const ASESOR = { user: { id: "ase-1", role: "ASESOR", plaza: "CANCUN" } };
const LIDER = { user: { id: "tl-1", role: "TEAM_LEADER", plaza: "CANCUN" } };
const DIRECTOR = { user: { id: "dir-1", role: "DIRECTOR", plaza: "CANCUN" } };
const SOLO_PROPYTE = { brandIds: ["b-def"], includesDefault: true };

const referido = (id: string, assignedToId: string | null, extra: Record<string, unknown> = {}) => ({
  id,
  firstName: `Nombre-${id}`,
  lastName: "Apellido",
  contactType: "COMPRADOR",
  contactStatus: "NUEVO",
  createdAt: new Date("2026-10-19T10:00:00Z"),
  assignedToId,
  assignedTo: assignedToId ? { id: assignedToId, name: `Asesor ${assignedToId}` } : null,
  brands: [],
  ...extra,
});

function broker(referrals: unknown[], total = referrals.length) {
  return {
    id: "brk",
    firstName: "Bruno",
    lastName: "Broker",
    contactType: "BROKER_EXTERNO",
    assignedToId: "ase-1",
    brands: [],
    referredBy: null,
    referrals,
    _count: { referrals: total },
  };
}

beforeEach(() => {
  for (const m of [contactFindFirst, userFindMany, getVisibleBrands]) m.mockReset();
  getVisibleBrands.mockResolvedValue(SOLO_PROPYTE);
  userFindMany.mockResolvedValue([{ id: "ase-2" }]); // equipo del líder
  sesion = ASESOR;
});

describe("getContact — referidos del broker (#907)", () => {
  it("pide los referidos vivos, del más nuevo al más viejo, con tope", async () => {
    contactFindFirst.mockResolvedValue(broker([]));
    await getContact("brk");
    const include = contactFindFirst.mock.calls[0][0].include;
    expect(include.referrals.where).toEqual({ deletedAt: null });
    expect(include.referrals.orderBy).toEqual({ createdAt: "desc" });
    expect(include.referrals.take).toBe(500);
    expect(include._count.select.referrals).toEqual({ where: { deletedAt: null } });
  });

  it("asesor: lista solo los referidos que él puede abrir y cuenta los de otros", async () => {
    contactFindFirst.mockResolvedValue(
      broker([referido("r1", "ase-1"), referido("r2", "ase-2"), referido("r3", null)]),
    );
    const c = await getContact("brk");
    expect(c.referidos.map((r: { id: string }) => r.id)).toEqual(["r1"]);
    expect(c.referidosNoListados).toBe(2);
  });

  it("los ocultos no se nombran: ni su nombre ni su id llegan en la respuesta", async () => {
    contactFindFirst.mockResolvedValue(broker([referido("r1", "ase-1"), referido("r2", "ase-2")]));
    const c = await getContact("brk");
    const json = JSON.stringify(c);
    expect(json).not.toContain("Nombre-r2");
    expect(json).not.toContain('"r2"');
    // Y lo crudo (lista completa, conteo, dueños/marcas de los ligados) tampoco sale.
    expect(c).not.toHaveProperty("referrals");
    expect(c).not.toHaveProperty("_count");
    expect(c.referidos[0]).toEqual({
      id: "r1",
      nombre: "Nombre-r1 Apellido",
      contactType: "COMPRADOR",
      contactStatus: "NUEVO",
      createdAt: new Date("2026-10-19T10:00:00Z"),
      asesor: "Asesor ase-1",
    });
  });

  it("líder de equipo: ve los de su equipo y los sin dueño (misma regla que su ficha)", async () => {
    sesion = LIDER;
    contactFindFirst.mockResolvedValue({
      ...broker([referido("r1", "ase-2"), referido("r2", null), referido("r3", "otro")]),
      assignedToId: "tl-1",
    });
    const c = await getContact("brk");
    expect(c.referidos.map((r: { id: string }) => r.id)).toEqual(["r1", "r2"]);
    expect(c.referidosNoListados).toBe(1);
  });

  it("director: ve todos, salvo los de una marca que no ve", async () => {
    sesion = DIRECTOR;
    contactFindFirst.mockResolvedValue(
      broker([referido("r1", "ase-1"), referido("r2", "ase-2", { brands: [{ brandId: "b-yax" }] })]),
    );
    const c = await getContact("brk");
    expect(c.referidos.map((r: { id: string }) => r.id)).toEqual(["r1"]);
    expect(c.referidosNoListados).toBe(1);
  });

  it("más referidos que el tope: los que no se trajeron también cuentan como no listados", async () => {
    sesion = DIRECTOR;
    contactFindFirst.mockResolvedValue(broker([referido("r1", "ase-1")], 503));
    const c = await getContact("brk");
    expect(c.referidos).toHaveLength(1);
    expect(c.referidosNoListados).toBe(502);
  });

  it("un contacto sin referidos ni broker (o un mock viejo sin esas claves) no truena", async () => {
    contactFindFirst.mockResolvedValue({ id: "k1", assignedToId: "ase-1", brands: [] });
    const c = await getContact("k1");
    expect(c.referidos).toEqual([]);
    expect(c.referidosNoListados).toBe(0);
    expect(c.referredBy).toBeNull();
  });
});

describe("getContact — «Referido por» (#907)", () => {
  const conBroker = (b: Record<string, unknown>) => ({
    id: "k1",
    assignedToId: "ase-1",
    brands: [],
    referredBy: { id: "brk", firstName: "Bruno", lastName: "Broker", deletedAt: null, brands: [], ...b },
    referrals: [],
    _count: { referrals: 0 },
  });

  it("broker al alcance: nombre y enlace", async () => {
    contactFindFirst.mockResolvedValue(conBroker({ assignedToId: "ase-1" }));
    const c = await getContact("k1");
    expect(c.referredBy).toEqual({ id: "brk", nombre: "Bruno Broker", puedeAbrir: true });
  });

  it("broker de otro asesor: se nombra, pero sin enlace (y sin sus datos crudos)", async () => {
    contactFindFirst.mockResolvedValue(conBroker({ assignedToId: "ase-2" }));
    const c = await getContact("k1");
    expect(c.referredBy).toEqual({ id: "brk", nombre: "Bruno Broker", puedeAbrir: false });
  });

  it("broker borrado: sin enlace aunque sea mío", async () => {
    contactFindFirst.mockResolvedValue(conBroker({ assignedToId: "ase-1", deletedAt: new Date() }));
    const c = await getContact("k1");
    expect(c.referredBy?.puedeAbrir).toBe(false);
  });
});
