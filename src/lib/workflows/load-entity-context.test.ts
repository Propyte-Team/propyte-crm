import { describe, it, expect, vi, beforeEach } from "vitest";

const contactFind = vi.fn();
const dealFind = vi.fn();
const quoteFind = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    contact: { findUnique: (...a: unknown[]) => contactFind(...a) },
    deal: { findUnique: (...a: unknown[]) => dealFind(...a) },
    quote: { findFirst: (...a: unknown[]) => quoteFind(...a) },
    conversation: { findUnique: vi.fn() },
  },
}));

import { loadEntityContext, triggerDelayMinutes } from "./engine";
import { evaluateConditions } from "./evaluate-conditions";

beforeEach(() => { contactFind.mockReset(); dealFind.mockReset(); quoteFind.mockReset(); quoteFind.mockResolvedValue(null); });

describe("loadEntityContext", () => {
  it("contact: expone contact con score numérico y adAttribution", async () => {
    contactFind.mockResolvedValue({ id: "c1", score: 50, adAttribution: { campaignName: "X" } });
    const ctx = await loadEntityContext("contact", "c1");
    expect((ctx.contact as { id: string }).id).toBe("c1");
    expect((ctx.contact as { score: number }).score).toBe(50);
    expect(ctx.adAttribution).toEqual({ campaignName: "X" });
  });

  it("deal: expone deal + su contact", async () => {
    dealFind.mockResolvedValue({ id: "d1", contactId: "c1" });
    contactFind.mockResolvedValue({ id: "c1", score: 0, adAttribution: null });
    const ctx = await loadEntityContext("deal", "d1");
    expect((ctx.deal as { id: string }).id).toBe("d1");
    expect((ctx.contact as { id: string }).id).toBe("c1");
  });

  it("deal.hasQuote: false sin cotización, true con una no borrada; el resto del deal se conserva", async () => {
    dealFind.mockResolvedValue({ id: "d1", contactId: "c1", stage: "MEETING_COMPLETED" });
    contactFind.mockResolvedValue({ id: "c1", score: 0, adAttribution: null });

    const sin = await loadEntityContext("deal", "d1");
    expect((sin.deal as { stage: string }).stage).toBe("MEETING_COMPLETED");
    expect((sin.deal as { hasQuote: boolean }).hasQuote).toBe(false);
    expect(evaluateConditions({ all: [{ field: "deal.hasQuote", op: "eq", value: false }] } as never, sin)).toBe(true);

    quoteFind.mockResolvedValue({ id: "q1" });
    const con = await loadEntityContext("deal", "d1");
    expect((con.deal as { hasQuote: boolean }).hasQuote).toBe(true);
    expect(evaluateConditions({ all: [{ field: "deal.hasQuote", op: "eq", value: false }] } as never, con)).toBe(false);
    expect(quoteFind).toHaveBeenLastCalledWith(expect.objectContaining({ where: { dealId: "d1", deletedAt: null } }));
  });

  it("deal inexistente: no consulta cotizaciones", async () => {
    dealFind.mockResolvedValue(null);
    const ctx = await loadEntityContext("deal", "nope");
    expect(ctx.deal).toBeNull();
    expect(quoteFind).not.toHaveBeenCalled();
  });
});

describe("triggerDelayMinutes", () => {
  it("lee triggerConfig.delayMinutes positivo; 0 en cualquier otro caso", () => {
    expect(triggerDelayMinutes({ toStage: "X", delayMinutes: 2880 })).toBe(2880);
    expect(triggerDelayMinutes({ toStage: "X" })).toBe(0);
    expect(triggerDelayMinutes(null)).toBe(0);
    expect(triggerDelayMinutes({ delayMinutes: -5 })).toBe(0);
  });
});
