import { describe, it, expect, vi, beforeEach } from "vitest";

const applyMock = vi.fn().mockResolvedValue({ applied: true });
const contactFind = vi.fn().mockResolvedValue({ id: "c1", lifecycleStage: "LEAD", assignedToId: "u1" });

vi.mock("@/lib/db", () => ({
  default: { contact: { findUnique: (...a: unknown[]) => contactFind(...a) } },
}));
vi.mock("@/lib/lifecycle/apply", () => ({ applyLifecycleTransition: (...a: unknown[]) => applyMock(...a) }));

import { executeAction } from "./actions";

beforeEach(() => { applyMock.mockClear(); });

describe("SET_LIFECYCLE action", () => {
  it("invoca applyLifecycleTransition con auto=true por defecto", async () => {
    await executeAction({ id: "q1", actionType: "SET_LIFECYCLE", entityType: "contact", entityId: "c1",
      config: { toStage: "MQL" } } as never);
    expect(applyMock).toHaveBeenCalledWith(expect.objectContaining({ contactId: "c1", to: "MQL", auto: true }));
  });

  it("rechaza etapa inválida (skip)", async () => {
    const r = await executeAction({ id: "q1", actionType: "SET_LIFECYCLE", entityType: "contact", entityId: "c1",
      config: { toStage: "NOPE" } } as never);
    expect(r.skipped).toBe(true);
    expect(applyMock).not.toHaveBeenCalled();
  });
});
