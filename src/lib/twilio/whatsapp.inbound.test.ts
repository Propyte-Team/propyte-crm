import { describe, it, expect, vi, beforeEach } from "vitest";

const handleInboundMessage = vi.fn();
vi.mock("@/lib/messaging/core", () => ({ handleInboundMessage: (...a: unknown[]) => handleInboundMessage(...a) }));

import { handleInboundWhatsApp } from "./whatsapp";

beforeEach(() => handleInboundMessage.mockReset());

describe("handleInboundWhatsApp → core", () => {
  it("normaliza el payload de WhatsApp a IncomingMessage (channel WHATSAPP, senderId E.164, mid)", async () => {
    handleInboundMessage.mockResolvedValue({ id: "m1" });
    await handleInboundWhatsApp({
      From: "whatsapp:+5219991112233",
      Body: "hola",
      MessageSid: "wamid.ABC",
      ProfileName: "Ana",
    });
    // normalizePhone("+5219991112233") → "+529991112233"
    // (521... de 13 dígitos: se elimina el 1 de larga distancia → +52 9991112233)
    expect(handleInboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "WHATSAPP",
        senderId: "+529991112233",
        externalMessageId: "wamid.ABC",
        text: "hola",
        profileName: "Ana",
      }),
      {} // opts pass-through (triggerBot del webhook coalescente; default vacío)
    );
  });
});
