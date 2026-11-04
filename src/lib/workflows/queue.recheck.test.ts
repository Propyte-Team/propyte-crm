import { describe, it, expect, vi, beforeEach } from "vitest";

const dealFind = vi.fn();
const quoteFind = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    deal: { findUnique: (...a: unknown[]) => dealFind(...a) },
    quote: { findFirst: (...a: unknown[]) => quoteFind(...a) },
    contact: { findUnique: vi.fn().mockResolvedValue({ id: "c1", score: 0, adAttribution: null }) },
    conversation: { findUnique: vi.fn() },
  },
}));
vi.mock("./actions", () => ({ executeAction: vi.fn() }));

import { recheckFallido } from "./queue";

const cond = { all: [{ field: "deal.hasQuote", op: "eq", value: false }] };

beforeEach(() => {
  dealFind.mockReset().mockResolvedValue({ id: "d1", contactId: "c1" });
  quoteFind.mockReset();
});

describe("recheckFallido (regla pospuesta con triggerConfig.delayMinutes)", () => {
  it("sin recheckConditions no re-evalúa nada", async () => {
    expect(await recheckFallido({ subject: "x" }, "deal", "d1")).toBe(false);
    expect(dealFind).not.toHaveBeenCalled();
  });
  it("sigue sin cotización → ejecuta (no falla el recheck)", async () => {
    quoteFind.mockResolvedValue(null);
    expect(await recheckFallido({ recheckConditions: cond }, "deal", "d1")).toBe(false);
  });
  it("ya hay cotización → se omite", async () => {
    quoteFind.mockResolvedValue({ id: "q1" });
    expect(await recheckFallido({ recheckConditions: cond }, "deal", "d1")).toBe(true);
  });
  it("condiciones vacías no omiten", async () => {
    expect(await recheckFallido({ recheckConditions: {} }, "deal", "d1")).toBe(false);
  });
});
