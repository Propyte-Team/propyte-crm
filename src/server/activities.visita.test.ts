import { describe, it, expect, vi, beforeEach } from "vitest";

const activityFindUnique = vi.fn();
const activityUpdate = vi.fn();
const emitirVisitaRealizada = vi.fn();

vi.mock("@/lib/db", () => ({
  default: { activity: { findUnique: (...a: unknown[]) => activityFindUnique(...a), update: (...a: unknown[]) => activityUpdate(...a) } },
}));
vi.mock("@/lib/auth/session", () => ({ getServerSession: async () => ({ user: { id: "user-1", role: "ADMIN" } }) }));
vi.mock("@/lib/workflows/emisiones", () => ({ emitirVisitaRealizada: (...a: unknown[]) => emitirVisitaRealizada(...a) }));

import { updateActivity } from "./activities";

beforeEach(() => {
  emitirVisitaRealizada.mockReset();
  activityUpdate.mockReset().mockResolvedValue({ id: "act-1", activityType: "MEETING_SHOWROOM", contactId: "c1" });
});

describe("updateActivity — visit.completed", () => {
  it("emite al pasar a COMPLETADA desde otro estado", async () => {
    activityFindUnique.mockResolvedValue({ id: "act-1", userId: "user-1", status: "PENDIENTE", activityType: "MEETING_SHOWROOM" });
    await updateActivity("act-1", { status: "COMPLETADA" });
    expect(emitirVisitaRealizada).toHaveBeenCalledOnce();
  });

  it("no emite si ya estaba completada ni si no se toca el estado", async () => {
    activityFindUnique.mockResolvedValue({ id: "act-1", userId: "user-1", status: "COMPLETADA", activityType: "MEETING_SHOWROOM" });
    await updateActivity("act-1", { status: "COMPLETADA" });
    activityFindUnique.mockResolvedValue({ id: "act-1", userId: "user-1", status: "PENDIENTE", activityType: "MEETING_SHOWROOM" });
    await updateActivity("act-1", { subject: "otro asunto" });
    expect(emitirVisitaRealizada).not.toHaveBeenCalled();
  });
});
