import { describe, it, expect, vi, beforeEach } from "vitest";

// sendWhatsAppMessage es el embudo de side-effects de TODO WhatsApp saliente
// (dispatcher/bot L2, workflows SEND_WHATSAPP, agent tools, API manual): verifica
// que el markdown se convierte ANTES de entregar y que Message/Activity persisten
// exactamente el texto que salió por la red.

const deliverWhatsApp = vi.fn();
vi.mock("@/lib/whatsapp/transport", () => ({
  deliverWhatsApp: (...a: unknown[]) => deliverWhatsApp(...a),
  mediaSupportsCaption: (t: string) => ["image", "document", "video", "gif"].includes(t),
}));

const msgCreate = vi.fn();
const actCreate = vi.fn();
const convUpdate = vi.fn();
vi.mock("@/lib/db", () => {
  const db = {
    message: { create: (...a: unknown[]) => msgCreate(...a) },
    activity: { create: (...a: unknown[]) => actCreate(...a) },
    conversation: { update: (...a: unknown[]) => convUpdate(...a) },
  };
  return { default: db, prisma: db };
});

const ensureConversation = vi.fn();
vi.mock("@/lib/messaging/conversations", () => ({
  ensureConversation: (...a: unknown[]) => ensureConversation(...a),
}));

const meetSlaTimers = vi.fn();
vi.mock("@/lib/workflows/sla", () => ({
  meetSlaTimers: (...a: unknown[]) => meetSlaTimers(...a),
}));

import { sendWhatsAppMessage } from "./whatsapp";

beforeEach(() => {
  vi.resetAllMocks();
  deliverWhatsApp.mockResolvedValue({ externalId: "wamid.X", status: "SENT" });
  ensureConversation.mockResolvedValue({ id: "conv1" });
  convUpdate.mockResolvedValue({ id: "conv1" });
  msgCreate.mockResolvedValue({ id: "m1" });
  actCreate.mockResolvedValue({ id: "a1" });
  meetSlaTimers.mockResolvedValue(undefined);
});

describe("sendWhatsAppMessage — markdown → formato WhatsApp (todos los emisores)", () => {
  it("entrega el texto convertido y persiste el MISMO texto en Message y Activity", async () => {
    await sendWhatsAppMessage(
      "+5219991112233",
      "Agendo para **mañana a las 7 AM** — un asesor te contacta.",
      "c1",
      "u1"
    );

    const expected = "Agendo para *mañana a las 7 AM* — un asesor te contacta.";
    expect(deliverWhatsApp).toHaveBeenCalledWith(expect.any(String), expected);
    expect(msgCreate.mock.calls[0][0].data.body).toBe(expected);
    expect(actCreate.mock.calls[0][0].data.description).toBe(expected);
  });

  it("texto sin markdown pasa sin cambios", async () => {
    await sendWhatsAppMessage("+5219991112233", "hola, ¿cómo vas?", "c1", "u1");
    expect(deliverWhatsApp).toHaveBeenCalledWith(expect.any(String), "hola, ¿cómo vas?");
    expect(msgCreate.mock.calls[0][0].data.body).toBe("hola, ¿cómo vas?");
  });
});

describe("sendWhatsAppMessage — media", () => {
  it("sticker con texto → texto aparte primero, luego media; Message persiste media", async () => {
    await sendWhatsAppMessage("+5219991112233", "toma", "c1", "u1", null, {
      path: "2026-07/s.webp", url: "https://sb/s.webp", type: "sticker", mimeType: "image/webp",
    });
    expect(deliverWhatsApp).toHaveBeenNthCalledWith(1, expect.any(String), "toma");
    expect(deliverWhatsApp).toHaveBeenNthCalledWith(2, expect.any(String), "toma",
      expect.objectContaining({ url: "https://sb/s.webp", type: "sticker" }));
    expect(msgCreate.mock.calls[0][0].data).toMatchObject({
      mediaUrl: "2026-07/s.webp", mediaType: "sticker", mediaMimeType: "image/webp",
    });
  });

  it("imagen sin texto → 1 sola entrega y body placeholder", async () => {
    await sendWhatsAppMessage("+5219991112233", "", "c1", "u1", null, {
      path: "2026-07/a.jpg", url: "https://sb/a.jpg", type: "image",
    });
    expect(deliverWhatsApp).toHaveBeenCalledTimes(1);
    expect(msgCreate.mock.calls[0][0].data.body).toBe("[Imagen]");
  });
});
