import { describe, it, expect, vi, beforeEach } from "vitest";

const session = { user: { id: "u1", role: "ADMIN" } };
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => Promise.resolve(session) }));
const txn = { actionPlanStep: { deleteMany: vi.fn(), createMany: vi.fn() }, actionPlan: { update: vi.fn().mockResolvedValue({ id: "p1" }) } };
const planUpdate = vi.fn().mockResolvedValue({ id: "p1" });
vi.mock("@/lib/db", () => ({
  default: {
    $transaction: (fn: (tx: typeof txn) => unknown) => fn(txn),
    actionPlan: { update: (...a: unknown[]) => planUpdate(...a) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  },
}));

import { PUT, DELETE } from "./route";

const ctx = { params: Promise.resolve({ id: "p1" }) };
function req(body: unknown) { return new Request("http://t", { method: "PUT", body: JSON.stringify(body) }) as never; }
beforeEach(() => { Object.values(txn.actionPlanStep).forEach((f) => f.mockClear()); txn.actionPlan.update.mockClear(); session.user.role = "ADMIN"; });

describe("PUT/DELETE /plans/[id]", () => {
  it("PUT reemplaza pasos (deleteMany + createMany con order 0..n)", async () => {
    const res = await PUT(req({ name: "Edit", steps: [
      { actionType: "SEND_WHATSAPP", delayMinutes: 0, config: {}, autonomyLevel: "L0" },
      { actionType: "CREATE_TASK", delayMinutes: 30, config: {}, autonomyLevel: "L0" },
    ] }), ctx);
    expect(res.status).toBe(200);
    expect(txn.actionPlanStep.deleteMany).toHaveBeenCalledWith({ where: { planId: "p1" } });
    const created = txn.actionPlanStep.createMany.mock.calls[0][0].data;
    expect(created.map((s: { order: number }) => s.order)).toEqual([0, 1]);
  });

  it("DELETE hace soft-delete (deletedAt)", async () => {
    const res = await DELETE(new Request("http://t", { method: "DELETE" }) as never, ctx);
    expect(res.status).toBe(200);
    expect(planUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "p1" }, data: expect.objectContaining({ deletedAt: expect.anything() }),
    }));
  });

  it("403 no-admin en PUT", async () => {
    session.user.role = "ASESOR_SR";
    const res = await PUT(req({ name: "X", steps: [] }), ctx);
    expect(res.status).toBe(403);
  });
});
