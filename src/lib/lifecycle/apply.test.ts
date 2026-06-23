import { describe, it, expect, vi, beforeEach } from "vitest";

const updateMock = vi.fn();
const activityCreateMock = vi.fn();
const emitMock = vi.fn();

vi.mock("@/lib/db", () => ({
  default: {
    contact: { update: (...a: unknown[]) => updateMock(...a) },
    activity: { create: (...a: unknown[]) => activityCreateMock(...a) },
  },
}));
vi.mock("@/lib/workflows/events", () => ({
  emitEvent: (...a: unknown[]) => emitMock(...a),
}));

import { applyLifecycleTransition } from "./apply";

beforeEach(() => { updateMock.mockReset(); activityCreateMock.mockReset(); emitMock.mockReset(); });

describe("applyLifecycleTransition", () => {
  it("avanza, persiste, emite evento y escribe Activity", async () => {
    const res = await applyLifecycleTransition({
      contactId: "c1", from: "LEAD", to: "MQL", actorUserId: "u1", auto: false,
    });
    expect(res.applied).toBe(true);
    expect(updateMock).toHaveBeenCalledWith({ where: { id: "c1" }, data: { lifecycleStage: "MQL" } });
    expect(emitMock).toHaveBeenCalledWith("contact.lifecycle_changed", "contact", "c1",
      expect.objectContaining({ fromStage: "LEAD", toStage: "MQL" }));
    expect(activityCreateMock).toHaveBeenCalled();
  });

  it("auto NO retrocede (skip sin efectos)", async () => {
    const res = await applyLifecycleTransition({
      contactId: "c1", from: "CLIENTE", to: "MQL", auto: true,
    });
    expect(res.applied).toBe(false);
    expect(updateMock).not.toHaveBeenCalled();
    expect(emitMock).not.toHaveBeenCalled();
  });

  it("manual SÍ puede retroceder", async () => {
    const res = await applyLifecycleTransition({
      contactId: "c1", from: "CLIENTE", to: "MQL", actorUserId: "u1", auto: false,
    });
    expect(res.applied).toBe(true);
    expect(updateMock).toHaveBeenCalled();
  });

  it("no-op si from === to", async () => {
    const res = await applyLifecycleTransition({ contactId: "c1", from: "MQL", to: "MQL", auto: false });
    expect(res.applied).toBe(false);
    expect(updateMock).not.toHaveBeenCalled();
  });
});
