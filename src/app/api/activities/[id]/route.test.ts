import { describe, it, expect, vi, beforeEach } from "vitest";

const updateActivity = vi.fn();
const deleteActivity = vi.fn();
vi.mock("@/server/activities", () => ({
  updateActivity: (...a: unknown[]) => updateActivity(...a),
  deleteActivity: (...a: unknown[]) => deleteActivity(...a),
}));

import { PATCH } from "./route";

function req(body: unknown) {
  return new Request("http://localhost/api/activities/act-1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}

const ctx = { params: { id: "act-1" } };

beforeEach(() => {
  updateActivity.mockReset();
  updateActivity.mockResolvedValue({ id: "act-1" });
});

describe("PATCH /api/activities/[id] — dueDate", () => {
  it("ancla un datetime-local sin zona a la hora de pared de Cancún", async () => {
    const res = await PATCH(req({ dueDate: "2026-07-30T14:30" }), ctx);

    expect(res.status).toBe(200);
    const arg = updateActivity.mock.calls[0][1];
    expect(arg.dueDate.toISOString()).toBe("2026-07-30T19:30:00.000Z");
  });

  it("conserva null para borrar la fecha límite", async () => {
    const res = await PATCH(req({ dueDate: null }), ctx);

    expect(res.status).toBe(200);
    expect(updateActivity.mock.calls[0][1].dueDate).toBeNull();
  });

  it("rechaza con 400 una fecha de calendario imposible", async () => {
    const res = await PATCH(req({ dueDate: "2026-04-31" }), ctx);

    expect(res.status).toBe(400);
    expect(updateActivity).not.toHaveBeenCalled();
  });
});
