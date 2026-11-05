import { describe, it, expect, vi, beforeEach } from "vitest";

const groupBy = vi.fn();
const findMany = vi.fn();
vi.mock("@/lib/db", () => ({
  default: { actionQueue: { groupBy: (...a: unknown[]) => groupBy(...a) }, automationRule: { findMany: (...a: unknown[]) => findMany(...a) } },
}));
const getServerSession = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => getServerSession() }));

import { GET } from "./route";

const pedir = () => GET(new Request("http://localhost/api/admin/journey/metrics/resumen?window=30"));
const sesion = (role: string) => getServerSession.mockResolvedValue({ user: { id: "u1", role } });

beforeEach(() => {
  vi.clearAllMocks();
  groupBy.mockResolvedValue([{ ruleId: "r1", status: "DONE", _count: { _all: 4 } }]);
  findMany.mockResolvedValue([{ id: "r1", name: "WF1", isActive: true }]);
});

describe("GET /api/admin/journey/metrics/resumen (permisos)", () => {
  it("403 sin sesión", async () => {
    getServerSession.mockResolvedValue(null);
    expect((await pedir()).status).toBe(403);
  });
  it.each(["ASESOR_SR", "ASESOR_JR", "TEAM_LEADER", "MARKETING"])("403 para %s", async (rol) => {
    sesion(rol);
    expect((await pedir()).status).toBe(403);
    expect(groupBy).not.toHaveBeenCalled();
  });
  it.each(["ADMIN", "DIRECTOR", "GERENTE"])("200 para %s", async (rol) => {
    sesion(rol);
    const res = await pedir();
    expect(res.status).toBe(200);
    expect((await res.json()).reglas).toHaveLength(1);
  });
});
