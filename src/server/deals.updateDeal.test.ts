import { describe, it, expect, vi, beforeEach } from "vitest";

const dealFindUnique = vi.fn();
const dealUpdate = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    deal: {
      findUnique: (...a: unknown[]) => dealFindUnique(...a),
      update: (...a: unknown[]) => dealUpdate(...a),
    },
  },
}));

vi.mock("@/lib/auth/session", () => ({
  getServerSession: async () => ({ user: { id: "user-1", role: "ADMIN" } }),
}));

// Stub async plano: un mock que rechaza haría fallar el test aunque el código lo capture.
vi.mock("@/lib/webhooks/dispatcher", () => ({ dispatchWebhook: async () => undefined }));

import { updateDeal } from "./deals";

beforeEach(() => {
  dealFindUnique.mockReset();
  dealFindUnique.mockResolvedValue({ id: "deal-1" });
  dealUpdate.mockReset();
  dealUpdate.mockResolvedValue({ id: "deal-1" });
});

describe("updateDeal — expectedCloseDate (bug A, nunca pasó por ningún schema)", () => {
  it("ancla una fecha sin hora a medianoche de Cancún, no de UTC", async () => {
    // Antes del fix: `new Date(data.expectedCloseDate)` crudo. "2026-07-30"
    // sería medianoche UTC = 19:00 del 29 en Cancún.
    await updateDeal("deal-1", { expectedCloseDate: "2026-07-30" });

    const arg = dealUpdate.mock.calls[0][0];
    expect(arg.data.expectedCloseDate.toISOString()).toBe("2026-07-30T05:00:00.000Z");
  });

  it("acepta un Date ya construido y lo pasa intacto", async () => {
    const instant = new Date("2026-07-30T16:00:00.000Z");
    await updateDeal("deal-1", { expectedCloseDate: instant });

    expect(dealUpdate.mock.calls[0][0].data.expectedCloseDate).toBe(instant);
  });

  it("lanza un error claro con una fecha inválida en vez de guardar una fecha corrida", async () => {
    await expect(
      updateDeal("deal-1", { expectedCloseDate: "no-es-fecha" }),
    ).rejects.toThrow('expectedCloseDate inválido: "no-es-fecha"');
    expect(dealUpdate).not.toHaveBeenCalled();
  });
});
