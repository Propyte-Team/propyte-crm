import { describe, it, expect, vi, beforeEach } from "vitest";

const session = { user: { id: "u1", role: "ADMIN", plaza: "CANCUN" } };
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => Promise.resolve(session) }));

const contactFindUnique = vi.fn();
const dealCreate = vi.fn();
const activityCreate = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    contact: { findUnique: (...a: unknown[]) => contactFindUnique(...a) },
    development: { findUnique: vi.fn() },
    unit: { findUnique: vi.fn() },
    deal: { create: (...a: unknown[]) => dealCreate(...a) },
    activity: { create: (...a: unknown[]) => activityCreate(...a) },
  },
}));

import { POST } from "./route";

const CONTACT_ID = "11111111-1111-1111-1111-111111111111";
const DEAL_BASE = {
  contactId: CONTACT_ID,
  dealType: "NATIVA_CONTADO",
  estimatedValue: 1000000,
  leadSourceAtDeal: "META_ADS",
};

function req(body: unknown) {
  return new Request("http://localhost/api/deals", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}

beforeEach(() => {
  session.user.role = "ADMIN";
  contactFindUnique.mockReset();
  contactFindUnique.mockResolvedValue({ leadSource: "META_ADS" });
  dealCreate.mockReset();
  dealCreate.mockResolvedValue({ id: "deal-1" });
  activityCreate.mockReset();
  activityCreate.mockResolvedValue({ id: "act-1" });
});

describe("POST /api/deals — expectedCloseDate", () => {
  it("ancla una fecha sin hora a medianoche de Cancún, no de UTC", async () => {
    // <input type="date"> manda "2026-07-30". Con z.coerce.date() eso sería
    // medianoche UTC = 19:00 del 29 en Cancún, y el deal quedaría fechado un
    // día antes. Medianoche de Cancún (UTC−5) son las 05:00Z.
    const res = await POST(req({ ...DEAL_BASE, expectedCloseDate: "2026-07-30" }));

    expect(res.status).toBe(201);
    const arg = dealCreate.mock.calls[0][0];
    expect(arg.data.expectedCloseDate.toISOString()).toBe("2026-07-30T05:00:00.000Z");
  });

  it("respeta un datetime con Z tal cual viene", async () => {
    const res = await POST(
      req({ ...DEAL_BASE, expectedCloseDate: "2026-07-30T16:00:00.000Z" }),
    );

    expect(res.status).toBe(201);
    expect(dealCreate.mock.calls[0][0].data.expectedCloseDate.toISOString()).toBe(
      "2026-07-30T16:00:00.000Z",
    );
  });

  it("rechaza con 400 una fecha de calendario imposible (30 de febrero)", async () => {
    const res = await POST(req({ ...DEAL_BASE, expectedCloseDate: "2026-02-30" }));

    expect(res.status).toBe(400);
    expect(dealCreate).not.toHaveBeenCalled();
  });

  it("rechaza con 400 una fecha ilegible", async () => {
    const res = await POST(req({ ...DEAL_BASE, expectedCloseDate: "no-es-fecha" }));

    expect(res.status).toBe(400);
    expect(dealCreate).not.toHaveBeenCalled();
  });
});
