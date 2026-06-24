import { describe, it, expect, vi, beforeEach } from "vitest";

const session = { user: { id: "u1", role: "ADMIN" } };
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => Promise.resolve(session) }));
const findUnique = vi.fn();
const upsert = vi.fn().mockResolvedValue({ id: "general", positions: {} });
vi.mock("@/lib/db", () => ({
  default: { journeyLayout: { findUnique: (...a: unknown[]) => findUnique(...a), upsert: (...a: unknown[]) => upsert(...a) } },
}));

import { GET, PUT } from "./route";

beforeEach(() => { findUnique.mockReset(); upsert.mockClear(); session.user.role = "ADMIN"; });

describe("journey layout API", () => {
  it("GET devuelve {} si no existe el scope", async () => {
    findUnique.mockResolvedValue(null);
    const res = await GET(new Request("http://t/api?scope=general") as never);
    expect(res.status).toBe(200);
    expect((await res.json()).positions).toEqual({});
  });

  it("PUT hace upsert de posiciones válidas", async () => {
    const body = { scope: "general", positions: { "rule:r1": { x: 10, y: 20 } } };
    const res = await PUT(new Request("http://t/api", { method: "PUT", body: JSON.stringify(body) }) as never);
    expect(res.status).toBe(200);
    expect(upsert).toHaveBeenCalled();
  });

  it("PUT 400 con positions malformado", async () => {
    const res = await PUT(new Request("http://t/api", { method: "PUT",
      body: JSON.stringify({ scope: "general", positions: { "x": { x: "no", y: 1 } } }) }) as never);
    expect(res.status).toBe(400);
  });

  it("PUT 403 no-admin", async () => {
    session.user.role = "ASESOR_SR";
    const res = await PUT(new Request("http://t/api", { method: "PUT",
      body: JSON.stringify({ scope: "general", positions: {} }) }) as never);
    expect(res.status).toBe(403);
  });
});
