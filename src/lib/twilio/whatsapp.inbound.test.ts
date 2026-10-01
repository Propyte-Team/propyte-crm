import { describe, it, expect, vi, beforeEach } from "vitest";

const handleInboundMessage = vi.fn();
vi.mock("@/lib/messaging/core", () => ({ handleInboundMessage: (...a: unknown[]) => handleInboundMessage(...a) }));

const contactFindFirst = vi.fn();
const contactUpdate = vi.fn();
vi.mock("@/lib/db", () => {
  const db = {
    contact: {
      findFirst: (...a: unknown[]) => contactFindFirst(...a),
      update: (...a: unknown[]) => contactUpdate(...a),
    },
  };
  return { default: db, prisma: db };
});

const emitEvent = vi.fn();
vi.mock("@/lib/workflows/events", () => ({ emitEvent: (...a: unknown[]) => emitEvent(...a) }));

import { handleInboundWhatsApp } from "./whatsapp";

beforeEach(() => {
  handleInboundMessage.mockReset();
  contactFindFirst.mockReset();
  contactUpdate.mockReset();
  emitEvent.mockReset();
});

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
        senderIdIsPhone: true,
        externalMessageId: "wamid.ABC",
        text: "hola",
        profileName: "Ana",
      }),
      {} // opts pass-through (triggerBot del webhook coalescente; default vacío)
    );
  });

  it("con teléfono real, pasa el BSUID aparte en whatsappUserId (no-regresión #826 + #827)", async () => {
    handleInboundMessage.mockResolvedValue({ id: "m1" });
    await handleInboundWhatsApp({
      From: "whatsapp:+5219991112233",
      WhatsAppUserId: "MX.123",
      Body: "hola",
      MessageSid: "wamid.ABC",
    });
    expect(handleInboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({ senderId: "+529991112233", senderIdIsPhone: true, whatsappUserId: "MX.123" }),
      {},
    );
  });
});

// ---------------------------------------------------------------------------
// #827 — From: null (Meta mandó el mensaje sin wa_id, fuera de la ventana de 30
// días): senderId pasa a ser el BSUID sin decorar, nunca un "teléfono" inventado.
// ---------------------------------------------------------------------------
describe("handleInboundWhatsApp — #827 sin teléfono real (BSUID-only)", () => {
  it("From: null → senderId es el BSUID crudo, senderIdIsPhone:false, NUNCA pasa por normalizePhone", async () => {
    handleInboundMessage.mockResolvedValue({ id: "m1" });
    await handleInboundWhatsApp({
      From: null,
      WhatsAppUserId: "MX.sin-telefono",
      Body: "hola",
      MessageSid: "wamid.XYZ",
    });
    expect(handleInboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "WHATSAPP",
        senderId: "MX.sin-telefono",
        senderIdIsPhone: false,
        whatsappUserId: "MX.sin-telefono",
      }),
      {},
    );
  });

  it("From: null y sin WhatsAppUserId (caso límite): senderId cae a un sentinel, nunca null/undefined", async () => {
    handleInboundMessage.mockResolvedValue(null);
    await handleInboundWhatsApp({ From: null, Body: "hola", MessageSid: "wamid.Z" });
    const [msg] = handleInboundMessage.mock.calls[0] as [{ senderId: string; senderIdIsPhone: boolean }];
    expect(msg.senderId).toBe("desconocido");
    expect(msg.senderIdIsPhone).toBe(false);
  });

  it("opt-out (BAJA) sin teléfono real: busca el contacto por BSUID, no por teléfono", async () => {
    contactFindFirst.mockResolvedValue({ id: "c1" });
    contactUpdate.mockResolvedValue({ id: "c1" });
    const result = await handleInboundWhatsApp({
      From: null,
      WhatsAppUserId: "MX.sin-telefono",
      Body: "BAJA",
      MessageSid: "wamid.OPT",
    });
    expect(contactFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ whatsappUserId: "MX.sin-telefono" }) }),
    );
    expect(contactUpdate).toHaveBeenCalledWith({ where: { id: "c1" }, data: { whatsappOptOut: true } });
    expect(handleInboundMessage).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it("opt-out sin teléfono y sin BSUID: no hay a quién buscar, no truena", async () => {
    const result = await handleInboundWhatsApp({ From: null, Body: "STOP", MessageSid: "wamid.OPT2" });
    expect(contactFindFirst).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });
});
