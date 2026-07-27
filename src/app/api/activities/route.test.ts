import { describe, it, expect, vi, beforeEach } from "vitest";

const session = { user: { id: "u1", role: "ADMIN" } };
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => Promise.resolve(session) }));

const contactFindUnique = vi.fn();
const dealFindUnique = vi.fn();
const activityCreate = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    contact: { findUnique: (...a: unknown[]) => contactFindUnique(...a) },
    deal: { findUnique: (...a: unknown[]) => dealFindUnique(...a) },
    activity: { create: (...a: unknown[]) => activityCreate(...a) },
  },
}));

import { POST } from "./route";

const CONTACT_ID = "11111111-1111-1111-1111-111111111111";

function req(body: unknown) {
  return new Request("http://localhost/api/activities", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}

beforeEach(() => {
  session.user.role = "ADMIN";
  contactFindUnique.mockReset();
  contactFindUnique.mockResolvedValue({ id: CONTACT_ID });
  dealFindUnique.mockReset();
  activityCreate.mockReset();
  activityCreate.mockResolvedValue({ id: "act-1" });
});

describe("POST /api/activities — dueDate", () => {
  it("ancla un datetime-local sin zona a la hora de pared de Cancún", async () => {
    // El caso roto: stage-transition-dialog.tsx manda esto crudo desde un
    // <input type="datetime-local">. Antes de este fix, z.coerce.date() lo
    // interpretaba según la TZ del proceso.
    const res = await POST(
      req({
        contactId: CONTACT_ID,
        activityType: "MEETING_VIRTUAL",
        subject: "Reunión agendada",
        dueDate: "2026-07-30T14:30",
      }),
    );

    expect(res.status).toBe(201);
    const arg = activityCreate.mock.calls[0][0];
    expect(arg.data.dueDate.toISOString()).toBe("2026-07-30T19:30:00.000Z");
  });

  it("rechaza con 400 una fecha de calendario imposible", async () => {
    const res = await POST(
      req({
        contactId: CONTACT_ID,
        activityType: "TASK",
        subject: "Fecha imposible",
        dueDate: "2026-02-30",
      }),
    );

    expect(res.status).toBe(400);
    expect(activityCreate).not.toHaveBeenCalled();
  });

  it("sigue respetando un dueDate con Z tal cual (consumidores que ya mandan ISO)", async () => {
    const res = await POST(
      req({
        contactId: CONTACT_ID,
        activityType: "CALL_OUTBOUND",
        subject: "Llamada registrada",
        dueDate: "2026-07-30T16:00:00.000Z",
      }),
    );

    expect(res.status).toBe(201);
    expect(activityCreate.mock.calls[0][0].data.dueDate.toISOString()).toBe(
      "2026-07-30T16:00:00.000Z",
    );
  });
});
