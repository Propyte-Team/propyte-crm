import { describe, it, expect, vi, beforeEach } from "vitest";

// #828: este endpoint (lo usa el panel de conversación de Detalle de Contacto,
// aparte del inbox) no resolvía connectorId en absoluto. Con una sola línea de
// WhatsApp es invisible, pero con 2+ marcas activas TODO mensaje enviado desde
// aquí —normal o plantilla— salía por el número global del env sin importar a
// cuál línea le escribió el cliente, mientras el inbox (que sí pasa
// conv.connectorId) respondía bien. Esta batería fija que el fix resuelve el
// connector del HILO MÁS RECIENTE de WhatsApp del contacto y lo pasa a ambos
// caminos de envío.

const getServerSession = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getServerSession: (...a: unknown[]) => getServerSession(...a) }));

const contactFindUnique = vi.fn();
vi.mock("@/lib/db", () => {
  const db = { contact: { findUnique: (...a: unknown[]) => contactFindUnique(...a) } };
  return { default: db, prisma: db };
});

const findConversationForChannel = vi.fn();
vi.mock("@/lib/messaging/conversations", () => ({
  findConversationForChannel: (...a: unknown[]) => findConversationForChannel(...a),
}));

const sendWhatsAppMessage = vi.fn();
const sendWhatsAppTemplate = vi.fn();
vi.mock("@/lib/twilio/whatsapp", () => ({
  sendWhatsAppMessage: (...a: unknown[]) => sendWhatsAppMessage(...a),
  sendWhatsAppTemplate: (...a: unknown[]) => sendWhatsAppTemplate(...a),
}));

import { POST } from "./route";

function req(body: unknown) {
  return new Request("https://x", { method: "POST", body: JSON.stringify(body) }) as never;
}

beforeEach(() => {
  getServerSession.mockReset().mockResolvedValue({ user: { id: "u1" } });
  contactFindUnique.mockReset().mockResolvedValue({ phone: "+5219991112233" });
  findConversationForChannel.mockReset().mockResolvedValue(null);
  sendWhatsAppMessage.mockReset().mockResolvedValue({ id: "m1" });
  sendWhatsAppTemplate.mockReset().mockResolvedValue({ id: "m1" });
});

describe("POST /api/twilio/whatsapp — #828 resuelve connectorId del hilo más reciente", () => {
  it("mensaje normal: sin conversación previa, connectorId es null (número global, no-regresión)", async () => {
    const res = await POST(req({ contactId: "c1", body: "hola" }));
    expect(res.status).toBe(200);
    expect(findConversationForChannel).toHaveBeenCalledWith("c1", "WHATSAPP");
    expect(sendWhatsAppMessage).toHaveBeenCalledWith("+5219991112233", "hola", "c1", "u1", null);
  });

  it("mensaje normal: con conversación en una línea de marca, pasa SU connectorId (antes se ignoraba)", async () => {
    findConversationForChannel.mockResolvedValue({ id: "conv1", connectorId: "connector-nativa" });
    await POST(req({ contactId: "c1", body: "hola" }));
    expect(sendWhatsAppMessage).toHaveBeenCalledWith("+5219991112233", "hola", "c1", "u1", "connector-nativa");
  });

  it("plantilla: sin conversación previa, connectorId es null (no-regresión)", async () => {
    await POST(req({ contactId: "c1", templateName: "recordatorio_cita", templateParams: ["Ana"] }));
    expect(sendWhatsAppTemplate).toHaveBeenCalledWith(
      "+5219991112233", "recordatorio_cita", ["Ana"], "c1", "u1", null,
    );
  });

  it("plantilla: con conversación en una línea de marca, pasa SU connectorId (antes SIEMPRE salía por el número global)", async () => {
    findConversationForChannel.mockResolvedValue({ id: "conv1", connectorId: "connector-nativa" });
    await POST(req({ contactId: "c1", templateName: "recordatorio_cita", templateParams: ["Ana"] }));
    expect(sendWhatsAppTemplate).toHaveBeenCalledWith(
      "+5219991112233", "recordatorio_cita", ["Ana"], "c1", "u1", "connector-nativa",
    );
  });
});
