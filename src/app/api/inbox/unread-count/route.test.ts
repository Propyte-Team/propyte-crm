import { describe, it, expect, vi, beforeEach } from "vitest";

const getServerSession = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => getServerSession() }));

const convCount = vi.fn();
vi.mock("@/lib/db", () => ({
  default: { conversation: { count: (...a: unknown[]) => convCount(...a) } },
}));

// Marcas (2026-10-12): por defecto el usuario ve todas, así las pruebas de arriba siguen
// midiendo solo el alcance por rol. Las de marca (al final) cambian el valor.
const getVisibleBrands = vi.fn();
vi.mock("@/lib/brands/user-access", () => ({ getVisibleBrands: (...a: unknown[]) => getVisibleBrands(...a) }));

import { GET } from "./route";

beforeEach(() => {
  [getServerSession, convCount, getVisibleBrands].forEach((m) => m.mockReset());
  convCount.mockResolvedValue(0);
  getVisibleBrands.mockResolvedValue("ALL");
});

const ASESOR = { user: { id: "ase-1", role: "ASESOR_SR" } };
const GERENTE = { user: { id: "boss-1", role: "GERENTE" } };

function whereUsed() {
  return convCount.mock.calls[0][0].where;
}

describe("GET /api/inbox/unread-count", () => {
  it("sin sesión: 401 y no consulta la base", async () => {
    getServerSession.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(convCount).not.toHaveBeenCalled();
  });

  it("devuelve el count que regresa Prisma", async () => {
    getServerSession.mockResolvedValue(ASESOR);
    convCount.mockResolvedValue(4);
    const res = await GET();
    const body = await res.json();
    expect(body).toEqual({ count: 4 });
  });

  it("siempre filtra por status distinto de CLOSED y unreadCount > 0", async () => {
    getServerSession.mockResolvedValue(GERENTE);
    await GET();
    const where = whereUsed();
    expect(where.status).toEqual({ not: "CLOSED" });
    expect(where.unreadCount).toEqual({ gt: 0 });
  });

  it("MISMO alcance que /api/conversations: asesor queda acotado a suyos + sin asignar", async () => {
    getServerSession.mockResolvedValue(ASESOR);
    await GET();
    expect(whereUsed().contact).toEqual({
      AND: [{ OR: [{ assignedToId: "ase-1" }, { assignedToId: null }] }],
    });
  });

  it("gerente (alcance completo): no agrega condición de contacto", async () => {
    getServerSession.mockResolvedValue(GERENTE);
    await GET();
    expect(whereUsed().contact).toBeUndefined();
  });
});

describe("GET /api/inbox/unread-count — marcas (2026-10-12)", () => {
  const SOLO_PROPYTE = { brandIds: ["b-def"], includesDefault: true };
  const MARCA = {
    OR: [
      { assignedToId: "boss-1" },
      { brands: { some: { brandId: { in: ["b-def"] } } } },
      { brands: { none: {} } },
    ],
  };

  it("gerente sin Yaxnáh: el badge no cuenta hilos de marcas que no ve", async () => {
    getServerSession.mockResolvedValue(GERENTE);
    getVisibleBrands.mockResolvedValue(SOLO_PROPYTE);
    await GET();
    expect(whereUsed().contact).toEqual({ AND: [MARCA] });
  });

  it("asesor: alcance por rol AND marca, en el mismo término", async () => {
    getServerSession.mockResolvedValue(ASESOR);
    getVisibleBrands.mockResolvedValue(SOLO_PROPYTE);
    await GET();
    expect(whereUsed().contact).toEqual({
      AND: [
        {
          AND: [
            { OR: [{ assignedToId: "ase-1" }, { assignedToId: null }] },
            { OR: [{ assignedToId: "ase-1" }, MARCA.OR[1], MARCA.OR[2]] },
          ],
        },
      ],
    });
  });
});
