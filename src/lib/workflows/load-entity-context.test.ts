import { describe, it, expect, vi, beforeEach } from "vitest";

const contactFind = vi.fn();
const dealFind = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    contact: { findUnique: (...a: unknown[]) => contactFind(...a) },
    deal: { findUnique: (...a: unknown[]) => dealFind(...a) },
    conversation: { findUnique: vi.fn() },
  },
}));

import { loadEntityContext } from "./engine";

beforeEach(() => { contactFind.mockReset(); dealFind.mockReset(); });

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
});
