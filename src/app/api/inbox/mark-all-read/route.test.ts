import { describe, it, expect, vi, beforeEach } from "vitest";

const getServerSession = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => getServerSession() }));

const updateMany = vi.fn();
const count = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    conversation: {
      updateMany: (...a: unknown[]) => updateMany(...a),
      count: (...a: unknown[]) => count(...a),
    },
  },
}));

const getVisibleBrands = vi.fn();
vi.mock("@/lib/brands/user-access", () => ({ getVisibleBrands: (...a: unknown[]) => getVisibleBrands(...a) }));

import { POST } from "./route";
import { GET as unreadCountGET } from "../unread-count/route";

beforeEach(() => {
  [getServerSession, updateMany, count, getVisibleBrands].forEach((m) => m.mockReset());
  updateMany.mockResolvedValue({ count: 0 });
  count.mockResolvedValue(0);
  getVisibleBrands.mockResolvedValue("ALL");
});

const ASESOR = { user: { id: "ase-1", role: "ASESOR_SR" } };
const GERENTE = { user: { id: "boss-1", role: "GERENTE" } };
const TEAM_LEADER = { user: { id: "tl-1", role: "TEAM_LEADER" } };
const SOLO_PROPYTE = { brandIds: ["b-def"], includesDefault: true };

describe("POST /api/inbox/mark-all-read (#928)", () => {
  it("sin sesión: 401 y no toca la base", async () => {
    getServerSession.mockResolvedValue(null);
    const res = await POST();
    expect(res.status).toBe(401);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("pone unreadCount en 0 y devuelve cuántas conversaciones tocó", async () => {
    getServerSession.mockResolvedValue(GERENTE);
    updateMany.mockResolvedValue({ count: 155 });
    const res = await POST();
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ updated: 155 });
    expect(updateMany.mock.calls[0][0].data).toEqual({ unreadCount: 0 });
  });

  it("solo abiertas y con no leídos", async () => {
    getServerSession.mockResolvedValue(GERENTE);
    await POST();
    const where = updateMany.mock.calls[0][0].where;
    expect(where.status).toEqual({ not: "CLOSED" });
    expect(where.unreadCount).toEqual({ gt: 0 });
  });

  it("asesor: no toca hilos de otros asesores (suyos + sin asignar)", async () => {
    getServerSession.mockResolvedValue(ASESOR);
    await POST();
    expect(updateMany.mock.calls[0][0].where.contact).toEqual({
      AND: [{ OR: [{ assignedToId: "ase-1" }, { assignedToId: null }] }],
    });
  });

  // El botón debe dejar el badge en 0: los dos usan exactamente el mismo where.
  it.each([
    ["GERENTE", GERENTE, "ALL"],
    ["ASESOR", ASESOR, "ALL"],
    ["TEAM_LEADER", TEAM_LEADER, "ALL"],
    ["GERENTE sin Yaxnáh", GERENTE, SOLO_PROPYTE],
    ["ASESOR sin Yaxnáh", ASESOR, SOLO_PROPYTE],
  ])("%s: mismo where que el badge del menú", async (_n, session, brands) => {
    getServerSession.mockResolvedValue(session);
    getVisibleBrands.mockResolvedValue(brands);
    await POST();
    await unreadCountGET();
    expect(updateMany.mock.calls[0][0].where).toEqual(count.mock.calls[0][0].where);
  });

  it("error de base: 500 sin filtrar el mensaje", async () => {
    getServerSession.mockResolvedValue(GERENTE);
    updateMany.mockRejectedValue(new Error("connection reset"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST();
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Error interno del servidor");
  });
});
