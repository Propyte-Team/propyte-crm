import { describe, it, expect, vi, beforeEach } from "vitest";

const sendWhatsAppMessage = vi.fn();
const sendInstagram = vi.fn();
const contactFindUnique = vi.fn();
const connectorFindFirst = vi.fn();
const connectorFindUnique = vi.fn();
const msgCreate = vi.fn();
const msgUpdate = vi.fn();
const convFindFirst = vi.fn();
const convCreate = vi.fn();
const convUpdate = vi.fn();

vi.mock("@/lib/twilio/whatsapp", () => ({ sendWhatsAppMessage: (...a: unknown[]) => sendWhatsAppMessage(...a) }));
vi.mock("./adapters/instagram", () => ({ sendInstagram: (...a: unknown[]) => sendInstagram(...a) }));
vi.mock("./adapters/messenger", () => ({ sendMessenger: vi.fn() }));
vi.mock("@/lib/intake/connectors", () => ({ readCredentials: () => ({ pageAccessToken: "PAGE_TOKEN" }) }));
vi.mock("@/lib/db", () => ({
  default: {
    contact: { findUnique: (...a: unknown[]) => contactFindUnique(...a) },
    leadConnector: {
      findFirst: (...a: unknown[]) => connectorFindFirst(...a),
      findUnique: (...a: unknown[]) => connectorFindUnique(...a),
    },
    conversation: {
      findFirst: (...a: unknown[]) => convFindFirst(...a),
      create: (...a: unknown[]) => convCreate(...a),
      update: (...a: unknown[]) => convUpdate(...a),
    },
    message: {
      create: (...a: unknown[]) => msgCreate(...a),
      update: (...a: unknown[]) => msgUpdate(...a),
    },
    activity: { create: vi.fn() },
  },
}));
vi.mock("@/lib/workflows/sla", () => ({ meetSlaTimers: vi.fn() }));

import { sendChannelMessage } from "./dispatcher";

beforeEach(() => {
  [sendWhatsAppMessage, sendInstagram, contactFindUnique, connectorFindFirst, connectorFindUnique, msgCreate, msgUpdate, convFindFirst, convCreate, convUpdate].forEach((m) => m.mockReset());
  convFindFirst.mockResolvedValue({ id: "conv1" });
  convUpdate.mockResolvedValue({ id: "conv1" });
  msgCreate.mockResolvedValue({ id: "m1" });
  msgUpdate.mockResolvedValue({ id: "m1", sender: "BOT", aiGenerated: true, aiAutonomy: "L2" });
});

describe("sendChannelMessage", () => {
  it("WHATSAPP delega en sendWhatsAppMessage", async () => {
    contactFindUnique.mockResolvedValue({ id: "c1", phone: "+521999", instagramId: null, messengerPsid: null });
    sendWhatsAppMessage.mockResolvedValue({ id: "wa-msg" });
    await sendChannelMessage("WHATSAPP", "c1", "hola", "u1");
    expect(sendWhatsAppMessage).toHaveBeenCalledWith("+521999", "hola", "c1", "u1", null);
  });

  it("INSTAGRAM envía por adapter con el IGSID del contacto y guarda Message OUTBOUND", async () => {
    contactFindUnique.mockResolvedValue({ id: "c1", phone: "+521999", instagramId: "IGSID-1", messengerPsid: null });
    connectorFindUnique.mockResolvedValue({ id: "conn1", status: "ACTIVE", credentials: "enc" });
    sendInstagram.mockResolvedValue({ externalMessageId: "mid-out", status: "SENT" });
    await sendChannelMessage("INSTAGRAM", "c1", "hola", "u1", { connectorId: "conn1" });
    expect(connectorFindUnique).toHaveBeenCalledWith({ where: { id: "conn1" } });
    expect(sendInstagram).toHaveBeenCalledWith("PAGE_TOKEN", "IGSID-1", "hola");
    expect(msgCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ channel: "INSTAGRAM", direction: "OUTBOUND", externalMessageId: "mid-out", sender: "ADVISOR" }) })
    );
  });

  it("INSTAGRAM con {bot:true} guarda sender BOT y aiGenerated true", async () => {
    contactFindUnique.mockResolvedValue({ id: "c1", phone: "+521999", instagramId: "IGSID-1", messengerPsid: null });
    connectorFindUnique.mockResolvedValue({ id: "conn1", status: "ACTIVE", credentials: "enc" });
    sendInstagram.mockResolvedValue({ externalMessageId: "mid-bot", status: "SENT" });
    await sendChannelMessage("INSTAGRAM", "c1", "hola", "u1", { bot: true, connectorId: "conn1" });
    expect(msgCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ sender: "BOT", aiGenerated: true }),
      })
    );
  });

  it("INSTAGRAM sin opts bot sigue siendo sender ADVISOR", async () => {
    contactFindUnique.mockResolvedValue({ id: "c1", phone: "+521999", instagramId: "IGSID-2", messengerPsid: null });
    connectorFindUnique.mockResolvedValue({ id: "conn1", status: "ACTIVE", credentials: "enc" });
    sendInstagram.mockResolvedValue({ externalMessageId: "mid-adv", status: "SENT" });
    await sendChannelMessage("INSTAGRAM", "c1", "hola", "u1", { connectorId: "conn1" });
    expect(msgCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ sender: "ADVISOR", aiGenerated: false }),
      })
    );
  });

  it("INSTAGRAM sin connectorId rechaza (evita cruce de tokens entre cuentas)", async () => {
    contactFindUnique.mockResolvedValue({ id: "c1", phone: "+521999", instagramId: "IGSID-1", messengerPsid: null });
    await expect(sendChannelMessage("INSTAGRAM", "c1", "hola", "u1")).rejects.toThrow(/connectorId/i);
    expect(connectorFindUnique).not.toHaveBeenCalled();
  });

  it("INSTAGRAM con connectorId de conector inactivo/inexistente rechaza", async () => {
    contactFindUnique.mockResolvedValue({ id: "c1", phone: "+521999", instagramId: "IGSID-1", messengerPsid: null });
    connectorFindUnique.mockResolvedValue(null);
    await expect(
      sendChannelMessage("INSTAGRAM", "c1", "hola", "u1", { connectorId: "conn-missing" })
    ).rejects.toThrow(/inválido o inactivo/i);
  });

  it("WHATSAPP con {bot:true} llama message.update con sender BOT", async () => {
    contactFindUnique.mockResolvedValue({ id: "c1", phone: "+521999", instagramId: null, messengerPsid: null });
    sendWhatsAppMessage.mockResolvedValue({ id: "wa1" });
    await sendChannelMessage("WHATSAPP", "c1", "hola bot", "u1", { bot: true });
    expect(msgUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "wa1" },
        data: expect.objectContaining({ sender: "BOT", aiGenerated: true, aiAutonomy: "L2" }),
      })
    );
  });
});
