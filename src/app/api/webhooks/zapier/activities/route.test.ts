import { describe, it, expect, vi, beforeEach } from "vitest";

const authenticateApiKey = vi.fn();
vi.mock("@/lib/auth/api-key", () => ({
  authenticateApiKey: (...a: unknown[]) => authenticateApiKey(...a),
}));

const activityCreate = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: { activity: { create: (...a: unknown[]) => activityCreate(...a) } },
}));

import { POST } from "./route";

function req(body: unknown) {
  return new Request("http://localhost/api/webhooks/zapier/activities", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer pk_live_test",
    },
    body: JSON.stringify(body),
  }) as never;
}

beforeEach(() => {
  authenticateApiKey.mockReset();
  authenticateApiKey.mockResolvedValue({ id: "key-1" });
  activityCreate.mockReset();
  activityCreate.mockResolvedValue({ id: "act-1" });
});

describe("POST /api/webhooks/zapier/activities — dueDate", () => {
  it("responde 400 con un dueDate ilegible en vez de guardar Invalid Date", async () => {
    // Antes del fix: `new Date(body.dueDate)` crudo. Un dueDate roto se
    // guardaba como Invalid Date en vez de rechazarse.
    const res = await POST(
      req({
        contactId: "c1",
        userId: "u1",
        activityType: "TASK",
        subject: "Tarea desde Zapier",
        dueDate: "no-es-fecha",
      }),
    );

    expect(res.status).toBe(400);
    expect(activityCreate).not.toHaveBeenCalled();
  });

  it("responde 400 con una fecha de calendario imposible", async () => {
    const res = await POST(
      req({
        contactId: "c1",
        userId: "u1",
        activityType: "TASK",
        subject: "Tarea desde Zapier",
        dueDate: "2026-02-30",
      }),
    );

    expect(res.status).toBe(400);
    expect(activityCreate).not.toHaveBeenCalled();
  });

  it("ancla un dueDate sin zona a la hora de pared de Cancún antes de guardar", async () => {
    await POST(
      req({
        contactId: "c1",
        userId: "u1",
        activityType: "TASK",
        subject: "Tarea desde Zapier",
        dueDate: "2026-07-30T14:30",
      }),
    );

    const arg = activityCreate.mock.calls[0][0];
    expect(arg.data.dueDate.toISOString()).toBe("2026-07-30T19:30:00.000Z");
  });

  it("permite omitir dueDate por completo", async () => {
    const res = await POST(
      req({
        contactId: "c1",
        userId: "u1",
        activityType: "TASK",
        subject: "Tarea sin fecha",
      }),
    );

    expect(res.status).toBe(201);
    expect(activityCreate.mock.calls[0][0].data.dueDate).toBeNull();
  });
});
