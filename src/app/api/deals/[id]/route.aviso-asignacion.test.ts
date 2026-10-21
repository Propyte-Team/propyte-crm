import { describe, it, expect, vi, beforeEach } from "vitest";

// #915: cambiar el asesor de un negocio le avisa al nuevo «Se te ha asignado un negocio».

const session = { user: { id: "u1", role: "ADMIN", plaza: "PDC", name: "Dirección" } };
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => Promise.resolve(session) }));

const dealFindUnique = vi.fn();
const txDealUpdate = vi.fn();
const userFindUnique = vi.fn();
const notificationCreate = vi.fn();

vi.mock("@/lib/db", () => ({
  default: {
    deal: { findUnique: (...a: unknown[]) => dealFindUnique(...a) },
    user: { findUnique: (...a: unknown[]) => userFindUnique(...a) },
    notification: { create: (...a: unknown[]) => notificationCreate(...a) },
  },
}));

vi.mock("@/lib/audit/change-context", () => ({
  withChangeSource: (_o: unknown, fn: (tx: unknown) => unknown) =>
    fn({ deal: { update: (...a: unknown[]) => txDealUpdate(...a) }, activity: { create: vi.fn() } }),
}));

import { PATCH } from "./route";

const DEAL_ID = "44444444-4444-4444-4444-444444444444";
const SARA = "33333333-3333-4333-8333-333333333333";

function req(body: unknown) {
  return new Request(`http://localhost/api/deals/${DEAL_ID}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}
const params = { params: Promise.resolve({ id: DEAL_ID }) };

beforeEach(() => {
  [dealFindUnique, txDealUpdate, userFindUnique, notificationCreate].forEach((m) => m.mockReset());
  dealFindUnique.mockResolvedValue({
    id: DEAL_ID,
    stage: "NEGOTIATION",
    contactId: "contact-1",
    assignedToId: "pedro",
    unitId: null,
    developmentId: "dev-1",
    hubUnitId: null,
    contact: { id: "contact-1" },
    assignedTo: { id: "pedro", plaza: "PDC", teamLeaderId: null },
    development: { id: "dev-1", name: "Kaab", commissionRate: 10 },
    activities: [],
  });
  txDealUpdate.mockResolvedValue({
    id: DEAL_ID,
    contact: { id: "contact-1", firstName: "Ana", lastName: "López" },
    development: { id: "dev-1", name: "Kaab" },
  });
  userFindUnique.mockResolvedValue({ id: SARA, email: "sara@propyte.com", isActive: true, deletedAt: null });
  notificationCreate.mockResolvedValue({ id: "n1" });
});

describe("PATCH /api/deals/[id] — cambiar el asesor avisa (#915)", () => {
  it("de Pedro a Sara: a Sara le llega «Se te ha asignado un negocio»", async () => {
    const res = await PATCH(req({ assignedToId: SARA }), params);
    expect(res.status).toBe(200);
    expect(notificationCreate).toHaveBeenCalledTimes(1);
    expect(notificationCreate.mock.calls[0][0].data).toEqual({
      userId: SARA,
      type: "deal_assigned",
      title: "Se te ha asignado un negocio",
      message: "Ana López · Kaab · Te lo asignó Dirección",
      link: `/pipeline/${DEAL_ID}`,
    });
  });

  it("editar el negocio sin cambiar el asesor no avisa", async () => {
    await PATCH(req({ estimatedValue: 2_000_000 }), params);
    expect(notificationCreate).not.toHaveBeenCalled();
  });
});
