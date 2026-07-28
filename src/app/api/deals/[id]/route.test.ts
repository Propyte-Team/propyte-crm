import { describe, it, expect, vi, beforeEach } from "vitest";

const session = { user: { id: "u1", role: "ADMIN", plaza: "CANCUN" } };
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => Promise.resolve(session) }));

const existingDeal = {
  id: "deal-1",
  stage: "NEGOTIATION",
  contactId: "contact-1",
  assignedToId: "u1",
  developmentId: null as string | null,
  unitId: null as string | null,
  hubUnitId: null as string | null,
  estimatedValue: 1000000,
  contact: {
    id: "contact-1",
    investmentProfile: "INVERSION",
    propertyType: "CONDO",
    budgetMin: 1000000,
    purchaseTimeline: "INMEDIATO",
  },
  assignedTo: { id: "u1", plaza: "CANCUN", teamLeaderId: null },
  development: null,
  unit: null,
};

const dealFindUnique = vi.fn();
const dealUpdate = vi.fn();
const activityCreate = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    deal: {
      findUnique: (...a: unknown[]) => dealFindUnique(...a),
      update: (...a: unknown[]) => dealUpdate(...a),
    },
    activity: { create: (...a: unknown[]) => activityCreate(...a) },
    development: { findUnique: vi.fn() },
    unit: { update: vi.fn() },
  },
}));

import { PATCH } from "./route";

const ctx = { params: { id: "deal-1" } };

function req(body: unknown) {
  return new Request("http://localhost/api/deals/deal-1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}

beforeEach(() => {
  session.user.role = "ADMIN";
  dealFindUnique.mockReset();
  dealFindUnique.mockResolvedValue(existingDeal);
  dealUpdate.mockReset();
  dealUpdate.mockResolvedValue({ id: "deal-1", stage: "WON", unitId: null });
  activityCreate.mockReset();
  activityCreate.mockResolvedValue({ id: "act-1" });
});

describe("PATCH /api/deals/[id] — actualCloseDate", () => {
  it("ancla, al ganar el deal, una fecha sin hora a medianoche de Cancún", async () => {
    // stage-transition-dialog.tsx manda "2026-07-30" desde un <input type="date">.
    // Con z.coerce.date() eso sería medianoche UTC = 19:00 del 29 en Cancún.
    const res = await PATCH(req({ stage: "WON", actualCloseDate: "2026-07-30" }), ctx);

    expect(res.status).toBe(200);
    const arg = dealUpdate.mock.calls[0][0];
    expect(arg.data.actualCloseDate.toISOString()).toBe("2026-07-30T05:00:00.000Z");
  });

  it("rechaza con 400 una fecha de calendario imposible (30 de febrero)", async () => {
    const res = await PATCH(req({ stage: "WON", actualCloseDate: "2026-02-30" }), ctx);

    expect(res.status).toBe(400);
    expect(dealUpdate).not.toHaveBeenCalled();
  });

  it("respeta un datetime con Z tal cual viene", async () => {
    const res = await PATCH(
      req({ stage: "WON", actualCloseDate: "2026-07-30T16:00:00.000Z" }),
      ctx,
    );

    expect(res.status).toBe(200);
    expect(dealUpdate.mock.calls[0][0].data.actualCloseDate.toISOString()).toBe(
      "2026-07-30T16:00:00.000Z",
    );
  });

  it("sigue auto-asignando la fecha actual si no se manda actualCloseDate al ganar", async () => {
    // Comportamiento preexistente que NO debe tocarse: new Date() real, no
    // parseDueDate — no viene de un formulario, es "ahora mismo".
    const before = Date.now();
    const res = await PATCH(req({ stage: "WON" }), ctx);
    const after = Date.now();

    expect(res.status).toBe(200);
    const assigned = dealUpdate.mock.calls[0][0].data.actualCloseDate as Date;
    expect(assigned.getTime()).toBeGreaterThanOrEqual(before);
    expect(assigned.getTime()).toBeLessThanOrEqual(after);
  });

  it("ancla expectedCloseDate sin hora a medianoche de Cancún al actualizarla", async () => {
    const res = await PATCH(req({ expectedCloseDate: "2026-08-01" }), ctx);

    expect(res.status).toBe(200);
    expect(dealUpdate.mock.calls[0][0].data.expectedCloseDate.toISOString()).toBe(
      "2026-08-01T05:00:00.000Z",
    );
  });
});
