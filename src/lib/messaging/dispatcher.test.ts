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
const sendGraphAttachment = vi.fn();
vi.mock("./graph", () => ({ sendGraphAttachment: (...a: unknown[]) => sendGraphAttachment(...a) }));
const signChatMediaUrls = vi.fn();
vi.mock("@/lib/storage/chat-media", () => ({
  isStoragePath: (v: string) => !/^https?:\/\//i.test(v),
  signChatMediaUrls: (...a: unknown[]) => signChatMediaUrls(...a),
}));

import { sendChannelMessage } from "./dispatcher";

beforeEach(() => {
  [sendWhatsAppMessage, sendInstagram, contactFindUnique, connectorFindFirst, connectorFindUnique, msgCreate, msgUpdate, convFindFirst, convCreate, convUpdate, sendGraphAttachment, signChatMediaUrls].forEach((m) => m.mockReset());
  signChatMediaUrls.mockResolvedValue({ "2026-07/a.jpg": "https://sb/signed-a" });
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
    // #687: la autoría viaja en el envío. Sin `{bot:true}` es un mensaje de asesor.
    expect(sendWhatsAppMessage).toHaveBeenCalledWith(
      "+521999", "hola", "c1", "u1", null, undefined, { autoriaBot: false },
    );
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

  it("MESSENGER con media → firma URL, manda attachment y persiste media en Message", async () => {
    const sendMessenger = (await import("./adapters/messenger")).sendMessenger as ReturnType<typeof vi.fn>;
    contactFindUnique.mockResolvedValue({ id: "c1", phone: null, instagramId: null, messengerPsid: "PSID-1" });
    connectorFindUnique.mockResolvedValue({ id: "conn1", status: "ACTIVE", credentials: "enc" });
    sendGraphAttachment.mockResolvedValue({ externalMessageId: "mid-att", status: "SENT" });

    await sendChannelMessage("MESSENGER", "c1", "", "u1", {
      connectorId: "conn1",
      media: { path: "2026-07/a.jpg", type: "image", filename: null, mimeType: "image/jpeg" },
    });
    expect(sendMessenger).not.toHaveBeenCalled(); // sin body → no mensaje de texto extra
    expect(sendGraphAttachment).toHaveBeenCalledWith("PAGE_TOKEN", "PSID-1", { url: "https://sb/signed-a", type: "image" });
    expect(msgCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        body: "[Imagen]", mediaUrl: "2026-07/a.jpg", mediaType: "image", externalMessageId: "mid-att",
      }),
    }));
  });

  it("INSTAGRAM con texto + media → 2 llamadas Graph (texto y attachment), 1 Message", async () => {
    contactFindUnique.mockResolvedValue({ id: "c1", phone: null, instagramId: "IGSID-1", messengerPsid: null });
    connectorFindUnique.mockResolvedValue({ id: "conn1", status: "ACTIVE", credentials: "enc" });
    sendInstagram.mockResolvedValue({ externalMessageId: "mid-txt", status: "SENT" });
    sendGraphAttachment.mockResolvedValue({ externalMessageId: "mid-att", status: "SENT" });

    await sendChannelMessage("INSTAGRAM", "c1", "mira esto", "u1", {
      connectorId: "conn1",
      media: { path: "2026-07/a.jpg", type: "gif" },
    });
    expect(sendInstagram).toHaveBeenCalledWith("PAGE_TOKEN", "IGSID-1", "mira esto");
    expect(sendGraphAttachment).toHaveBeenCalledWith("PAGE_TOKEN", "IGSID-1", { url: "https://sb/signed-a", type: "image" });
    expect(msgCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ body: "mira esto", mediaType: "gif", externalMessageId: "mid-att" }),
    }));
  });

  it("INSTAGRAM con documento → rechaza (la API de IG no soporta archivos)", async () => {
    await expect(
      sendChannelMessage("INSTAGRAM", "c1", "", "u1", {
        connectorId: "conn1",
        media: { path: "2026-07/doc.pdf", type: "document" },
      })
    ).rejects.toThrow(/no soporta adjuntos/i);
    expect(sendGraphAttachment).not.toHaveBeenCalled();
  });

  it("WHATSAPP con media → sendWhatsAppMessage recibe media con URL firmada", async () => {
    contactFindUnique.mockResolvedValue({ id: "c1", phone: "+521999", instagramId: null, messengerPsid: null });
    sendWhatsAppMessage.mockResolvedValue({ id: "wa-msg" });
    await sendChannelMessage("WHATSAPP", "c1", "checa", "u1", {
      media: { path: "2026-07/a.jpg", type: "image" },
    });
    expect(sendWhatsAppMessage).toHaveBeenCalledWith("+521999", "checa", "c1", "u1", null,
      expect.objectContaining({ path: "2026-07/a.jpg", url: "https://sb/signed-a", type: "image" }),
      { autoriaBot: false });
  });

  it("media con path infirmable → rechaza claro", async () => {
    contactFindUnique.mockResolvedValue({ id: "c1", phone: "+521999", instagramId: null, messengerPsid: null });
    signChatMediaUrls.mockResolvedValue({});
    await expect(
      sendChannelMessage("WHATSAPP", "c1", "", "u1", { media: { path: "2026-07/a.jpg", type: "image" } })
    ).rejects.toThrow(/firmar/i);
  });

  // #687: esta prueba comprobaba que se llamara a `message.update` DESPUÉS del envío para
  // corregir la autoría. Ese update ya no existe: la autoría viaja en el envío y la fila
  // nace con ella, igual que en el camino de Instagram/Messenger de este mismo archivo.
  // El contrato que hay que fijar ahora es que la marca llegue al envío, no que se corrija.
  it("WHATSAPP con {bot:true} manda la autoría EN el envío, sin update posterior", async () => {
    contactFindUnique.mockResolvedValue({ id: "c1", phone: "+521999", instagramId: null, messengerPsid: null });
    sendWhatsAppMessage.mockResolvedValue({ id: "wa1" });

    await sendChannelMessage("WHATSAPP", "c1", "hola bot", "u1", { bot: true });

    expect(sendWhatsAppMessage).toHaveBeenCalledWith(
      "+521999", "hola bot", "c1", "u1", null, undefined, { autoriaBot: true },
    );
    // Y nada que corregir después: es lo que elimina la ventana en la que la fila estaba mal.
    expect(msgUpdate).not.toHaveBeenCalled();
  });

  it("WHATSAPP con media y {bot:true}: la autoría no se pierde por llevar adjunto", async () => {
    // Las dos ramas del canal —con y sin media— llaman a la función por separado, así que
    // una podría quedarse sin la marca sin que la otra se enterara.
    contactFindUnique.mockResolvedValue({ id: "c1", phone: "+521999", instagramId: null, messengerPsid: null });
    sendWhatsAppMessage.mockResolvedValue({ id: "wa2" });

    await sendChannelMessage("WHATSAPP", "c1", "mira", "u1", {
      bot: true,
      media: { path: "2026-07/a.jpg", type: "image" },
    });

    expect(sendWhatsAppMessage).toHaveBeenCalledWith(
      "+521999", "mira", "c1", "u1", null,
      expect.objectContaining({ path: "2026-07/a.jpg" }),
      { autoriaBot: true },
    );
    expect(msgUpdate).not.toHaveBeenCalled();
  });
});
