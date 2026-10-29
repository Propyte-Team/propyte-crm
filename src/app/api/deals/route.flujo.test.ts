import { describe, it, expect, vi, beforeEach } from "vitest";

// #948 — POST /api/deals acepta el flujo del negocio. Vacío = automático: lo pone el disparador
// de la base (F5 si es Nativa; si no, el flujo del contacto).

const session = { user: { id: "u1", role: "ADMIN", plaza: "CANCUN" } };
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => Promise.resolve(session) }));

const dealCreate = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    contact: { findUnique: vi.fn(async () => ({ leadSource: "META_ADS" })) },
    development: { findUnique: vi.fn() },
    unit: { findUnique: vi.fn() },
    deal: { create: (...a: unknown[]) => dealCreate(...a) },
    activity: { create: vi.fn(async () => ({ id: "act-1" })) },
  },
}));

import { POST } from "./route";

const DEAL_BASE = {
  contactId: "11111111-1111-1111-1111-111111111111",
  dealType: "CORRETAJE",
  estimatedValue: 1000000,
  leadSourceAtDeal: "META_ADS",
  expectedCloseDate: "2026-12-15",
};

function req(body: unknown) {
  return new Request("http://localhost/api/deals", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}

beforeEach(() => {
  dealCreate.mockReset();
  dealCreate.mockResolvedValue({ id: "deal-1" });
});

describe("POST /api/deals — flujo (#948)", () => {
  it("guarda el flujo elegido", async () => {
    const res = await POST(req({ ...DEAL_BASE, flujo: "F1_CORRETAJE_VENDEDOR" }));
    expect(res.status).toBe(201);
    expect(dealCreate.mock.calls[0][0].data.flujo).toBe("F1_CORRETAJE_VENDEDOR");
  });

  it("sin flujo manda null para que lo llene la base", async () => {
    const res = await POST(req(DEAL_BASE));
    expect(res.status).toBe(201);
    expect(dealCreate.mock.calls[0][0].data.flujo).toBeNull();
  });

  it("un flujo que no existe se rechaza con 400", async () => {
    const res = await POST(req({ ...DEAL_BASE, flujo: "F0" }));
    expect(res.status).toBe(400);
    expect(dealCreate).not.toHaveBeenCalled();
  });
});
