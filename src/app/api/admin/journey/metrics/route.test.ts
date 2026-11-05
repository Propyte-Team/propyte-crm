import { describe, it, expect, vi, beforeEach } from "vitest";

const queryRaw = vi.fn();
vi.mock("@/lib/db", () => ({ default: { $queryRaw: (...a: unknown[]) => queryRaw(...a) } }));
const getServerSession = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => getServerSession() }));

import { GET } from "./route";

const pedir = () => GET(new Request("http://localhost/api/admin/journey/metrics?ruleId=r1&window=30"));
const sesion = (role: string) => getServerSession.mockResolvedValue({ user: { id: "u1", role } });

beforeEach(() => {
  vi.clearAllMocks();
  queryRaw.mockResolvedValueOnce([{ path: "0", n: 3 }]).mockResolvedValueOnce([{ total: 5 }]);
});

describe("GET /api/admin/journey/metrics (permisos)", () => {
  it("403 sin sesión", async () => {
    getServerSession.mockResolvedValue(null);
    expect((await pedir()).status).toBe(403);
  });
  it.each(["ASESOR_SR", "ASESOR_JR", "TEAM_LEADER", "MARKETING"])("403 para %s", async (rol) => {
    sesion(rol);
    expect((await pedir()).status).toBe(403);
    expect(queryRaw).not.toHaveBeenCalled();
  });
  it.each(["ADMIN", "DIRECTOR", "GERENTE"])("200 para %s", async (rol) => {
    sesion(rol);
    const res = await pedir();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ counts: { "0": 3 }, total: 5, window: "30" });
  });
});
