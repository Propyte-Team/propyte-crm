import { describe, it, expect, vi, beforeEach } from "vitest";

const getServerSession = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => getServerSession() }));

const convFindMany = vi.fn();
vi.mock("@/lib/db", () => ({
  default: { conversation: { findMany: (...a: unknown[]) => convFindMany(...a) } },
}));

import { GET } from "./route";

function req(qs = "") {
  return { nextUrl: new URL(`http://x/api/conversations${qs}`) } as never;
}

beforeEach(() => {
  [getServerSession, convFindMany].forEach((m) => m.mockReset());
  convFindMany.mockResolvedValue([]);
});

const ASESOR = { user: { id: "ase-1", role: "ASESOR_SR" } };
const GERENTE = { user: { id: "boss-1", role: "GERENTE" } };

function whereUsed() {
  return convFindMany.mock.calls[0][0].where;
}

describe("GET /api/conversations — aislamiento", () => {
  it("asesor sin search: scope suyos + sin asignar", async () => {
    getServerSession.mockResolvedValue(ASESOR);
    await GET(req());
    expect(whereUsed().contact).toEqual({
      AND: [{ OR: [{ assignedToId: "ase-1" }, { assignedToId: null }] }],
    });
  });

  it("REGRESIÓN fuga: asesor CON search conserva el scope (AND de ambos OR)", async () => {
    getServerSession.mockResolvedValue(ASESOR);
    await GET(req("?q=ana"));
    const contact = whereUsed().contact;
    expect(contact.AND).toHaveLength(2);
    expect(contact.AND[0]).toEqual({ OR: [{ assignedToId: "ase-1" }, { assignedToId: null }] });
    expect(contact.AND[1].OR).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ firstName: expect.anything() }),
        expect.objectContaining({ phone: expect.anything() }),
      ])
    );
  });

  it("gerente con search: solo la condición de búsqueda, sin scope", async () => {
    getServerSession.mockResolvedValue(GERENTE);
    await GET(req("?q=ana"));
    expect(whereUsed().contact.AND).toHaveLength(1);
  });

  it("gerente sin filtros: contact queda undefined", async () => {
    getServerSession.mockResolvedValue(GERENTE);
    await GET(req());
    expect(whereUsed().contact).toBeUndefined();
  });

  // TEAM_LEADER sigue SIN vista completa, pero su scope suma a su equipo: si no lo
  // tuviera, repartir la cola sería un viaje sin retorno (asigna → pierde el hilo).
  it("TEAM_LEADER NO tiene vista completa: lleva scope con su equipo", async () => {
    getServerSession.mockResolvedValue({ user: { id: "tl-1", role: "TEAM_LEADER" } });
    await GET(req());
    expect(whereUsed().contact.AND[0]).toEqual({
      OR: [
        { assignedToId: "tl-1" },
        { assignedToId: null },
        { assignedTo: { is: { teamLeaderId: "tl-1" } } },
      ],
    });
  });

  it("el término de equipo es SOLO del TEAM_LEADER: un asesor no lo lleva", async () => {
    getServerSession.mockResolvedValue(ASESOR);
    await GET(req());
    expect(JSON.stringify(whereUsed().contact)).not.toContain("teamLeaderId");
  });

  it("filtro mine compone con el scope del asesor", async () => {
    getServerSession.mockResolvedValue(ASESOR);
    await GET(req("?filter=mine"));
    expect(whereUsed().contact.AND).toEqual(
      expect.arrayContaining([{ assignedToId: "ase-1" }])
    );
  });

  it("filtro unassigned + search componen (3 condiciones para asesor)", async () => {
    getServerSession.mockResolvedValue(ASESOR);
    await GET(req("?filter=unassigned&q=ana"));
    expect(whereUsed().contact.AND).toHaveLength(3);
  });

  it("401 sin sesión", async () => {
    getServerSession.mockResolvedValue(null);
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(convFindMany).not.toHaveBeenCalled();
  });

  it("los filtros de estado (bot/human/unread) NO tocan where.contact", async () => {
    getServerSession.mockResolvedValue(GERENTE);
    await GET(req("?filter=bot"));
    expect(whereUsed().status).toBe("BOT");
    expect(whereUsed().contact).toBeUndefined();
  });
});
