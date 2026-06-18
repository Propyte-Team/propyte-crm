import { describe, it, expect, vi, beforeEach } from "vitest";

const findFirst = vi.fn();
const create = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    contact: {
      findFirst: (...a: unknown[]) => findFirst(...a),
      create: (...a: unknown[]) => create(...a),
      update: vi.fn(async () => ({})),
    },
    activity: { create: vi.fn(async () => ({})) },
  },
}));
vi.mock("@/lib/workflows/routing", () => ({ autoRouteLead: vi.fn(async () => ({ assignedToId: "u1" })) }));
vi.mock("@/lib/workflows/events", () => ({ emitEvent: vi.fn() }));

import { captureLead } from "./capture-lead";

beforeEach(() => { findFirst.mockReset(); create.mockReset(); });

describe("captureLead — identidad social", () => {
  it("matchea contacto existente por instagramId (no crea)", async () => {
    findFirst.mockResolvedValueOnce({ id: "c-ig", assignedToId: "u1" });
    const r = await captureLead({ source: "INSTAGRAM", firstName: "Ana", instagramId: "IG-1" });
    expect(r.isNew).toBe(false);
    expect(r.contactId).toBe("c-ig");
    expect(create).not.toHaveBeenCalled();
  });
  it("crea contacto nuevo persistiendo el instagramId", async () => {
    findFirst.mockResolvedValue(null);
    create.mockResolvedValueOnce({ id: "c-new", assignedToId: null });
    const r = await captureLead({ source: "INSTAGRAM", firstName: "Nuevo", instagramId: "IG-2" }, { skipRouting: true });
    expect(r.isNew).toBe(true);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ instagramId: "IG-2" }) }));
  });
});
