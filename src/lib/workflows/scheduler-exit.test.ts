import { describe, it, expect, vi, beforeEach } from "vitest";

const enrFind = vi.fn();
const enrUpdate = vi.fn();
const enqueue = vi.fn();
const loadCtx = vi.fn();

vi.mock("@/lib/db", () => ({
  default: {
    actionPlanEnrollment: {
      findMany: (...a: unknown[]) => enrFind(...a),
      update: (...a: unknown[]) => enrUpdate(...a),
    },
  },
}));
vi.mock("./queue", () => ({ enqueueAction: (...a: unknown[]) => enqueue(...a), dayBucket: () => "2026-06-24" }));
vi.mock("./engine", () => ({ loadEntityContext: (...a: unknown[]) => loadCtx(...a) }));

import { runEnrollments } from "./scheduler";

function enrollment(exitConditions: unknown) {
  return {
    id: "e1", entityType: "contact", entityId: "c1", currentStep: 0,
    plan: { isActive: true, exitConditions, steps: [
      { id: "s1", order: 0, actionType: "SEND_WHATSAPP", delayMinutes: 0, config: {}, autonomyLevel: "L0" },
      { id: "s2", order: 1, actionType: "SEND_WHATSAPP", delayMinutes: 60, config: {}, autonomyLevel: "L0" },
    ] },
  };
}

beforeEach(() => { enrFind.mockReset(); enrUpdate.mockReset(); enqueue.mockReset(); loadCtx.mockReset(); });

describe("runEnrollments exitConditions", () => {
  it("sale EXITED cuando exitConditions matchea (no encola)", async () => {
    enrFind.mockResolvedValue([enrollment({ all: [{ field: "contact.contactStatus", op: "eq", value: "CONTACTADO" }] })]);
    loadCtx.mockResolvedValue({ contact: { contactStatus: "CONTACTADO" } });
    await runEnrollments();
    expect(enqueue).not.toHaveBeenCalled();
    expect(enrUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "EXITED" }),
    }));
  });

  it("corre normal cuando exitConditions NO matchea", async () => {
    enrFind.mockResolvedValue([enrollment({ all: [{ field: "contact.contactStatus", op: "eq", value: "CONTACTADO" }] })]);
    loadCtx.mockResolvedValue({ contact: { contactStatus: "NUEVO" } });
    await runEnrollments();
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it("exitConditions vacío {} NO provoca salida (corre normal, sin cargar contexto)", async () => {
    enrFind.mockResolvedValue([enrollment({})]);
    await runEnrollments();
    expect(loadCtx).not.toHaveBeenCalled();
    expect(enqueue).toHaveBeenCalledTimes(1);
  });
});
