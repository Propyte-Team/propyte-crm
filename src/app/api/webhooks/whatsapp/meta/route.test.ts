import { describe, it, expect, vi, beforeEach } from "vitest";

// BUG 2026-07-24 (Bunker): un webhook con texto + 2 PDFs disparaba 3 respuestas del bot
// (una por mensaje del batch). Coalescing: ingerir TODO el batch con triggerBot:false y
// disparar el bot UNA vez por contacto al final.

const handleInboundWhatsApp = vi.fn();
vi.mock("@/lib/twilio/whatsapp", () => ({
  handleInboundWhatsApp: (...a: unknown[]) => handleInboundWhatsApp(...a),
}));

const botRespond = vi.fn();
vi.mock("@/lib/bot/bot-respond", () => ({ botRespond: (...a: unknown[]) => botRespond(...a) }));

const msgUpdateMany = vi.fn();
vi.mock("@/lib/db", () => ({
  default: { message: { updateMany: (...a: unknown[]) => msgUpdateMany(...a) } },
}));

vi.mock("@/lib/whatsapp/media", () => ({ resolveWaMediaToStorage: vi.fn(async () => null) }));

import { POST } from "./route";

function post(body: unknown) {
  return new Request("https://x/api/webhooks/whatsapp/meta", {
    method: "POST",
    body: JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest;
}

function waBody(messages: unknown[], statuses: unknown[] = []) {
  return { entry: [{ changes: [{ value: { contacts: [{ profile: { name: "Bunker" } }], messages, statuses } }] }] };
}

const TEXT = { id: "wamid.1", from: "529842036229", type: "text", text: { body: "Hola, buen día" } };
const DOC1 = { id: "wamid.2", from: "529842036229", type: "document", document: { id: "media1", filename: "Portfolio.pdf" } };
const DOC2 = { id: "wamid.3", from: "529842036229", type: "document", document: { id: "media2", filename: "CV.pdf" } };

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.META_WA_APP_SECRET; // sin secret no se valida firma
  handleInboundWhatsApp.mockResolvedValue({ id: "m1", contactId: "c1" });
  msgUpdateMany.mockResolvedValue({ count: 0 });
});

describe("whatsapp/meta webhook — coalescing del bot por batch", () => {
  it("batch de 3 mensajes del mismo remitente → 3 ingestas con triggerBot:false y bot UNA vez", async () => {
    const res = await POST(post(waBody([TEXT, DOC1, DOC2])));
    expect(res.status).toBe(200);
    expect(handleInboundWhatsApp).toHaveBeenCalledTimes(3);
    for (const call of handleInboundWhatsApp.mock.calls) {
      expect(call[1]).toEqual({ triggerBot: false });
    }
    expect(botRespond).toHaveBeenCalledTimes(1);
    expect(botRespond).toHaveBeenCalledWith("c1", { channel: "WHATSAPP" });
  });

  it("remitentes distintos en el batch → bot una vez POR contacto", async () => {
    handleInboundWhatsApp
      .mockResolvedValueOnce({ id: "m1", contactId: "c1" })
      .mockResolvedValueOnce({ id: "m2", contactId: "c2" });
    const otro = { ...TEXT, id: "wamid.9", from: "525512345678" };
    await POST(post(waBody([TEXT, otro])));
    expect(botRespond).toHaveBeenCalledTimes(2);
    expect(botRespond).toHaveBeenCalledWith("c1", { channel: "WHATSAPP" });
    expect(botRespond).toHaveBeenCalledWith("c2", { channel: "WHATSAPP" });
  });

  it("webhook solo de statuses → no llama al bot", async () => {
    await POST(post(waBody([], [{ id: "wamid.x", status: "delivered" }])));
    expect(botRespond).not.toHaveBeenCalled();
  });

  it("opt-out (handleInboundWhatsApp regresa null) → no llama al bot", async () => {
    handleInboundWhatsApp.mockResolvedValue(null);
    await POST(post(waBody([TEXT])));
    expect(botRespond).not.toHaveBeenCalled();
  });

  it("si el bot truena, el webhook igual regresa 200 (Meta no debe reintentar)", async () => {
    botRespond.mockRejectedValue(new Error("boom"));
    const res = await POST(post(waBody([TEXT])));
    expect(res.status).toBe(200);
  });
});
