import { describe, it, expect, vi, beforeEach } from "vitest";

const convFindFirst = vi.fn();
const convCreate = vi.fn();
const convUpdate = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    conversation: {
      findFirst: (...a: unknown[]) => convFindFirst(...a),
      create: (...a: unknown[]) => convCreate(...a),
      update: (...a: unknown[]) => convUpdate(...a),
    },
  },
}));

import { sameConversationKey, ensureConversation } from "./conversations";

interface ConvFixture { id: string; contactId: string; channel: string; connectorId: string | null }

/** Simula el findFirst de prisma contra fixtures respetando el where (incl. connectorId ausente). */
function setupConvs(convs: ConvFixture[]) {
  convFindFirst.mockImplementation(async (args: { where: Record<string, unknown> }) => {
    const w = args.where;
    return (
      convs.find(
        (c) =>
          c.contactId === w.contactId &&
          c.channel === w.channel &&
          (!("connectorId" in w) || c.connectorId === w.connectorId)
      ) ?? null
    );
  });
}

describe("sameConversationKey", () => {
  it("igual contacto+canal pero distinto connector → claves distintas", () => {
    expect(sameConversationKey(
      { contactId: "a", channel: "WHATSAPP", connectorId: "n1" },
      { contactId: "a", channel: "WHATSAPP", connectorId: "n2" },
    )).toBe(false);
  });
  it("mismo contacto+canal+connector → misma clave", () => {
    expect(sameConversationKey(
      { contactId: "a", channel: "WHATSAPP", connectorId: "n1" },
      { contactId: "a", channel: "WHATSAPP", connectorId: "n1" },
    )).toBe(true);
  });
  it("connector null en ambos → misma clave", () => {
    expect(sameConversationKey(
      { contactId: "a", channel: "WEB", connectorId: null },
      { contactId: "a", channel: "WEB", connectorId: null },
    )).toBe(true);
  });
});

// Cuenta WA en el Inbox (2026-07-25): al empezar a resolver connectorId para WhatsApp,
// los hilos viejos (connectorId null) NO deben partirse en dos conversaciones.
describe("ensureConversation — adopción de hilos", () => {
  beforeEach(() => {
    convFindFirst.mockReset();
    convCreate.mockReset();
    convUpdate.mockReset();
  });

  it("match exacto (contacto+canal+connector) se reusa sin crear ni adoptar", async () => {
    setupConvs([{ id: "conv-1", contactId: "c1", channel: "WHATSAPP", connectorId: "wa-1" }]);
    const conv = await ensureConversation({ contactId: "c1", channel: "WHATSAPP", connectorId: "wa-1" });
    expect(conv.id).toBe("conv-1");
    expect(convCreate).not.toHaveBeenCalled();
    expect(convUpdate).not.toHaveBeenCalled();
  });

  it("key CON connector + hilo legacy sin connector → lo ADOPTA (update, no crea)", async () => {
    setupConvs([{ id: "conv-legacy", contactId: "c1", channel: "WHATSAPP", connectorId: null }]);
    convUpdate.mockResolvedValue({ id: "conv-legacy", connectorId: "wa-1" });
    const conv = await ensureConversation({ contactId: "c1", channel: "WHATSAPP", connectorId: "wa-1" });
    expect(convUpdate).toHaveBeenCalledWith({ where: { id: "conv-legacy" }, data: { connectorId: "wa-1" } });
    expect(convCreate).not.toHaveBeenCalled();
    expect(conv.connectorId).toBe("wa-1");
  });

  it("key SIN connector + existe hilo con connector → reusa el existente (no parte el hilo)", async () => {
    setupConvs([{ id: "conv-x", contactId: "c1", channel: "WHATSAPP", connectorId: "wa-1" }]);
    const conv = await ensureConversation({ contactId: "c1", channel: "WHATSAPP", connectorId: null });
    expect(conv.id).toBe("conv-x");
    expect(convCreate).not.toHaveBeenCalled();
  });

  it("sin ningún hilo → crea con el connectorId dado", async () => {
    setupConvs([]);
    convCreate.mockResolvedValue({ id: "conv-new", connectorId: "wa-1" });
    const conv = await ensureConversation({ contactId: "c1", channel: "WHATSAPP", connectorId: "wa-1" });
    expect(convCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ connectorId: "wa-1", status: "BOT" }) })
    );
    expect(conv.id).toBe("conv-new");
  });
});
