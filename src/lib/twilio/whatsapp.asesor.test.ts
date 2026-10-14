// sendWhatsAppMessage con autoría de bot NUNCA sale por el WhatsApp propio de un asesor
// (2026-10-14, coexistencia PR 2, decisión 2 del dueño): venga del bot, de un workflow o de un
// agente. Un mensaje humano (la bandeja) sí sale por ahí: es justo para lo que se conectó.
import { describe, it, expect, vi, beforeEach } from "vitest";

const deliverWhatsApp = vi.fn();
vi.mock("@/lib/whatsapp/transport", () => ({
  deliverWhatsApp: (...a: unknown[]) => deliverWhatsApp(...a),
  mediaSupportsCaption: () => true,
}));
const db = vi.hoisted(() => ({
  message: { create: vi.fn(async () => ({ id: "m1" })) },
  activity: { create: vi.fn(async () => ({ id: "a1" })) },
  conversation: { update: vi.fn(async () => ({ id: "conv1" })) },
  contact: { findUnique: vi.fn(async () => null) },
}));
vi.mock("@/lib/db", () => ({ default: db, prisma: db }));
vi.mock("@/lib/messaging/conversations", () => ({ ensureConversation: async () => ({ id: "conv1" }) }));
vi.mock("@/lib/workflows/sla", () => ({ meetSlaTimers: async () => undefined }));
vi.mock("@/lib/whatsapp/accounts", () => ({ resolveWhatsAppSender: async () => ({ phoneNumberId: "pn-ana", accessToken: "tok" }) }));
const isAdvisorLine = vi.fn();
vi.mock("@/lib/whatsapp/coex/advisor-line", () => ({ isAdvisorLine: (...a: unknown[]) => isAdvisorLine(...a) }));

import { sendWhatsAppMessage } from "./whatsapp";

beforeEach(() => {
  deliverWhatsApp.mockReset();
  deliverWhatsApp.mockResolvedValue({ externalId: "wamid.X", status: "SENT" });
  isAdvisorLine.mockReset();
  isAdvisorLine.mockImplementation(async (id: string | null) => id === "conn-ana");
});

describe("sendWhatsAppMessage — número de asesor", () => {
  it("🚨 con autoría de bot por la cuenta de un asesor → lanza ANTES de tocar la red", async () => {
    await expect(
      sendWhatsAppMessage("+529981234567", "Hola, soy el asistente", "c1", "u1", "conn-ana", undefined, { autoriaBot: true }),
    ).rejects.toThrow(/WhatsApp propio de un asesor/);
    expect(deliverWhatsApp).not.toHaveBeenCalled();
    expect(db.message.create).not.toHaveBeenCalled();
  });

  it("el asesor escribiendo desde la bandeja SÍ sale por su número", async () => {
    await sendWhatsAppMessage("+529981234567", "Te marco en 5 min", "c1", "u-ana", "conn-ana");
    expect(isAdvisorLine).not.toHaveBeenCalled();
    expect(deliverWhatsApp).toHaveBeenCalledWith("+529981234567", "Te marco en 5 min", undefined, { phoneNumberId: "pn-ana", accessToken: "tok" }, null);
  });

  it("con autoría de bot por una línea de marca → sale como siempre", async () => {
    await sendWhatsAppMessage("+529981234567", "Hola", "c1", "u1", "conn-yax", undefined, { autoriaBot: true });
    expect(deliverWhatsApp).toHaveBeenCalled();
  });
});
