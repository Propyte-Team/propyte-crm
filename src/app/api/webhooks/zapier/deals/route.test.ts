import { describe, it, expect, vi, beforeEach } from "vitest";

const authenticateApiKey = vi.fn();
vi.mock("@/lib/auth/api-key", () => ({
  authenticateApiKey: (...a: unknown[]) => authenticateApiKey(...a),
}));

const dealCreate = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: { deal: { create: (...a: unknown[]) => dealCreate(...a) } },
}));

import { POST } from "./route";

const DEAL_BASE = {
  contactId: "c1",
  assignedToId: "u1",
  dealType: "NATIVA_CONTADO",
  estimatedValue: 1000000,
};

function req(body: unknown) {
  return new Request("http://localhost/api/webhooks/zapier/deals", {
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
  dealCreate.mockReset();
  dealCreate.mockResolvedValue({ id: "deal-1" });
});

describe("POST /api/webhooks/zapier/deals — expectedCloseDate", () => {
  it("responde 400 con un expectedCloseDate ilegible, con mensaje que incluye el valor recibido", async () => {
    // Antes del fix: `new Date(body.expectedCloseDate)` crudo. Un valor roto
    // producía un Invalid Date que Prisma rechazaba con un 500 opaco. Ahora
    // se valida antes y se responde 400 con un mensaje útil para depurar
    // desde el historial de un Zap.
    const res = await POST(
      req({ ...DEAL_BASE, expectedCloseDate: "no-es-fecha" }),
    );

    expect(res.status).toBe(400);
    expect(dealCreate).not.toHaveBeenCalled();
    const json = await res.json();
    expect(json.error).toContain("no-es-fecha");
  });

  it("responde 400 con una fecha de calendario imposible", async () => {
    const res = await POST(req({ ...DEAL_BASE, expectedCloseDate: "2026-02-30" }));

    expect(res.status).toBe(400);
    expect(dealCreate).not.toHaveBeenCalled();
  });

  it("ancla una fecha sin hora a medianoche de Cancún antes de guardar", async () => {
    await POST(req({ ...DEAL_BASE, expectedCloseDate: "2026-07-30" }));

    const arg = dealCreate.mock.calls[0][0];
    expect(arg.data.expectedCloseDate.toISOString()).toBe("2026-07-30T05:00:00.000Z");
  });

  it("respeta un datetime con Z tal cual viene", async () => {
    await POST(req({ ...DEAL_BASE, expectedCloseDate: "2026-07-30T16:00:00.000Z" }));

    expect(dealCreate.mock.calls[0][0].data.expectedCloseDate.toISOString()).toBe(
      "2026-07-30T16:00:00.000Z",
    );
  });

  it("permite omitir expectedCloseDate y usa el default de 90 días", async () => {
    const res = await POST(req({ ...DEAL_BASE }));

    expect(res.status).toBe(201);
    expect(dealCreate).toHaveBeenCalledOnce();
    const arg = dealCreate.mock.calls[0][0];
    expect(arg.data.expectedCloseDate).toBeInstanceOf(Date);
  });
});
