import { describe, it, expect, vi, beforeEach } from "vitest";

const sendWhatsAppMessage = vi.fn();
const sendInstagram = vi.fn();
const contactFindUnique = vi.fn();
const connectorFindFirst = vi.fn();
const msgCreate = vi.fn();
const convUpsert = vi.fn();

vi.mock("@/lib/twilio/whatsapp", () => ({ sendWhatsAppMessage: (...a: unknown[]) => sendWhatsAppMessage(...a) }));
vi.mock("./adapters/instagram", () => ({ sendInstagram: (...a: unknown[]) => sendInstagram(...a) }));
vi.mock("./adapters/messenger", () => ({ sendMessenger: vi.fn() }));
vi.mock("@/lib/intake/connectors", () => ({ readCredentials: () => ({ pageAccessToken: "PAGE_TOKEN" }) }));
vi.mock("@/lib/db", () => ({
  default: {
    contact: { findUnique: (...a: unknown[]) => contactFindUnique(...a) },
    leadConnector: { findFirst: (...a: unknown[]) => connectorFindFirst(...a) },
    conversation: { upsert: (...a: unknown[]) => convUpsert(...a) },
    message: { create: (...a: unknown[]) => msgCreate(...a) },
    activity: { create: vi.fn() },
  },
}));
vi.mock("@/lib/workflows/sla", () => ({ meetSlaTimers: vi.fn() }));

import { sendChannelMessage } from "./dispatcher";

beforeEach(() => {
  [sendWhatsAppMessage, sendInstagram, contactFindUnique, connectorFindFirst, msgCreate, convUpsert].forEach((m) => m.mockReset());
  convUpsert.mockResolvedValue({ id: "conv1" });
  msgCreate.mockResolvedValue({ id: "m1" });
});

describe("sendChannelMessage", () => {
  it("WHATSAPP delega en sendWhatsAppMessage", async () => {
    contactFindUnique.mockResolvedValue({ id: "c1", phone: "+521999", instagramId: null, messengerPsid: null });
    sendWhatsAppMessage.mockResolvedValue({ id: "wa-msg" });
    await sendChannelMessage("WHATSAPP", "c1", "hola", "u1");
    expect(sendWhatsAppMessage).toHaveBeenCalledWith("+521999", "hola", "c1", "u1");
  });

  it("INSTAGRAM envía por adapter con el IGSID del contacto y guarda Message OUTBOUND", async () => {
    contactFindUnique.mockResolvedValue({ id: "c1", phone: "+521999", instagramId: "IGSID-1", messengerPsid: null });
    connectorFindFirst.mockResolvedValue({ id: "conn1", credentials: "enc" });
    sendInstagram.mockResolvedValue({ externalMessageId: "mid-out", status: "SENT" });
    await sendChannelMessage("INSTAGRAM", "c1", "hola", "u1");
    expect(sendInstagram).toHaveBeenCalledWith("PAGE_TOKEN", "IGSID-1", "hola");
    expect(msgCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ channel: "INSTAGRAM", direction: "OUTBOUND", externalMessageId: "mid-out", sender: "ADVISOR" }) })
    );
  });
});
