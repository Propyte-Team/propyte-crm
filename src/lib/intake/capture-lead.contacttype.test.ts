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

describe("captureLead — contactType/temperature opcionales", () => {
  it("contactType explícito se persiste en contact.create", async () => {
    findFirst.mockResolvedValue(null);
    create.mockResolvedValueOnce({ id: "c-1", assignedToId: null });
    await captureLead(
      { source: "FACEBOOK_ADS", firstName: "A", email: "a@x.com", contactType: "BROKER_EXTERNO" },
      { connectorId: "conn-1", skipRouting: true }
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ contactType: "BROKER_EXTERNO" }) })
    );
  });

  it("sin contactType → fallback COMPRADOR", async () => {
    findFirst.mockResolvedValue(null);
    create.mockResolvedValueOnce({ id: "c-2", assignedToId: null });
    await captureLead(
      { source: "FACEBOOK_ADS", firstName: "B", email: "b@x.com" },
      { connectorId: "conn-1", skipRouting: true }
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ contactType: "COMPRADOR" }) })
    );
  });

  it("temperature explícita se persiste en contact.create", async () => {
    findFirst.mockResolvedValue(null);
    create.mockResolvedValueOnce({ id: "c-3", assignedToId: null });
    await captureLead(
      { source: "FACEBOOK_ADS", firstName: "C", email: "c@x.com", temperature: "HOT" },
      { connectorId: "conn-1", skipRouting: true }
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ temperature: "HOT" }) })
    );
  });

  it("sin temperature → no se fuerza el campo (default DB COLD)", async () => {
    findFirst.mockResolvedValue(null);
    create.mockResolvedValueOnce({ id: "c-4", assignedToId: null });
    await captureLead(
      { source: "FACEBOOK_ADS", firstName: "D", email: "d@x.com" },
      { connectorId: "conn-1", skipRouting: true }
    );
    const dataArg = create.mock.calls[0][0].data;
    expect(dataArg).not.toHaveProperty("temperature");
  });
});
