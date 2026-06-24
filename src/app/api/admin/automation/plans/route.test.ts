import { describe, it, expect, vi, beforeEach } from "vitest";

const session = { user: { id: "u1", role: "ADMIN" } };
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => Promise.resolve(session) }));
const planCreate = vi.fn().mockResolvedValue({ id: "p1" });
const auditCreate = vi.fn().mockResolvedValue({});
vi.mock("@/lib/db", () => ({
  default: {
    actionPlan: { create: (...a: unknown[]) => planCreate(...a) },
    auditLog: { create: (...a: unknown[]) => auditCreate(...a) },
  },
}));

import { POST } from "./route";

function req(body: unknown) { return new Request("http://t/api", { method: "POST", body: JSON.stringify(body) }) as never; }
beforeEach(() => { planCreate.mockClear(); session.user.role = "ADMIN"; });

describe("POST /plans", () => {
  it("crea plan con pasos ordenados", async () => {
    const res = await POST(req({ name: "Bienvenida", steps: [
      { actionType: "SEND_WHATSAPP", delayMinutes: 0, config: {}, autonomyLevel: "L0" },
      { actionType: "CREATE_TASK", delayMinutes: 60, config: {}, autonomyLevel: "L0" },
    ] }));
    expect(res.status).toBe(201);
    const arg = planCreate.mock.calls[0][0];
    expect(arg.data.steps.create.map((s: { order: number }) => s.order)).toEqual([0, 1]);
  });

  it("403 para no-admin", async () => {
    session.user.role = "ASESOR_SR";
    const res = await POST(req({ name: "X", steps: [] }));
    expect(res.status).toBe(403);
  });

  it("400 con actionType inválido", async () => {
    const res = await POST(req({ name: "X", steps: [{ actionType: "NOPE", delayMinutes: 0, config: {}, autonomyLevel: "L0" }] }));
    expect(res.status).toBe(400);
  });
});
