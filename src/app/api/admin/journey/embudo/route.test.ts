import { describe, it, expect, vi, beforeEach } from "vitest";

const groupBy = vi.fn();
const queryRaw = vi.fn();
const reglasFindMany = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    contact: { groupBy: (...a: unknown[]) => groupBy(...a) },
    automationRule: { findMany: (...a: unknown[]) => reglasFindMany(...a) },
    $queryRaw: (...a: unknown[]) => queryRaw(...a),
  },
}));
const getServerSession = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => getServerSession() }));

import { GET } from "./route";

const pedir = (qs = "") => GET(new Request(`http://localhost/api/admin/journey/embudo${qs}`));
const sesion = (role: string, plaza = "PDC") => getServerSession.mockResolvedValue({ user: { id: "u1", role, plaza } });

beforeEach(() => {
  vi.clearAllMocks();
  groupBy.mockResolvedValue([{ estado: "NUEVO", _count: { _all: 12 } }, { estado: null, _count: { _all: 2 } }]);
  queryRaw
    .mockResolvedValueOnce([
      { contactId: "a", desde: "NUEVO", hasta: "CONTACTADO", en: new Date(), source: "api", desdeEn: new Date(Date.now() - 3 * 86_400_000) },
    ])
    .mockResolvedValueOnce([{ contactId: "x", estado: "NUEVO", desde: new Date() }]);
  reglasFindMany.mockResolvedValue([
    { id: "r1", name: "WF5", isActive: true, triggerType: "STAGE_CHANGE", triggerConfig: { toStage: "RESERVED" } },
    { id: "r2", name: "WF1", isActive: false, triggerType: "EVENT", triggerConfig: { eventType: "lead.captured" } },
  ]);
});

describe("GET /api/admin/journey/embudo", () => {
  it("403 sin sesión", async () => {
    getServerSession.mockResolvedValue(null);
    expect((await pedir()).status).toBe(403);
  });

  it.each(["ASESOR_SR", "ASESOR_JR", "TEAM_LEADER", "MARKETING"])("403 para %s", async (rol) => {
    sesion(rol);
    expect((await pedir()).status).toBe(403);
    expect(groupBy).not.toHaveBeenCalled();
  });

  it.each(["ADMIN", "DIRECTOR", "GERENTE"])("200 para %s con la forma esperada", async (rol) => {
    sesion(rol);
    const res = await pedir("?dias=7");
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.dias).toBe(7);
    expect(j.pasos).toHaveLength(11);
    expect(j.pasos[0]).toMatchObject({ estado: "NUEVO", hoy: 12 });
    expect(j.pasos[2]).toMatchObject({ estado: "CONTACTADO", entraron: 1 });
    expect(j.porClasificar).toBe(2);
    expect(j.salidas.map((s: { estado: string }) => s.estado)).toEqual(["PERDIDO", "CONTACTADO_PERDIDO", "NEGOCIO_PERDIDO"]);
    expect(j.especiales.map((s: { estado: string }) => s.estado)).toEqual(["REGISTRADO_POR_BROKER", "DERIVADO_A_RH"]);
    expect(j.reglas).toEqual([
      { id: "r1", name: "WF5", isActive: true, paso: "APARTADO" },
      { id: "r2", name: "WF1", isActive: false, paso: "CUALQUIER_MOMENTO" },
    ]);
  });

  it("ventana inválida → 30 días", async () => {
    sesion("ADMIN");
    expect((await (await pedir("?dias=5")).json()).dias).toBe(30);
  });

  it("el gerente queda fijo en su plaza aunque pida otra", async () => {
    sesion("GERENTE", "TULUM");
    const j = await (await pedir("?plaza=PDC")).json();
    expect(j.plazaFija).toBe("TULUM");
    expect(groupBy.mock.calls[0][0].where.assignedTo).toEqual({ plaza: "TULUM" });
  });

  it("director filtra por plaza, flujo y asesor; ignora valores inválidos", async () => {
    sesion("DIRECTOR");
    await pedir("?plaza=MERIDA&flujo=F5_NATIVA&asesor=abc");
    expect(groupBy.mock.calls[0][0].where).toMatchObject({
      deletedAt: null, flujo: "F5_NATIVA", assignedToId: "abc", assignedTo: { plaza: "MERIDA" },
    });
    groupBy.mockClear();
    queryRaw.mockResolvedValue([]);
    await pedir("?plaza=NOPE&flujo=XX");
    expect(groupBy.mock.calls[0][0].where).toEqual({ deletedAt: null });
  });

  it("500 legible si la base falla", async () => {
    sesion("ADMIN");
    groupBy.mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await pedir();
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/embudo/i);
  });
});
