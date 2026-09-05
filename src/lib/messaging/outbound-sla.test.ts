import { describe, it, expect, vi, beforeEach } from "vitest";

// #731 — INVARIANTE: todo camino por el que sale un mensaje REAL al contacto detiene su
// reloj de SLA. Es el reverso de la #702: aquella quito el cierre por mensaje ENTRANTE
// (que daba por atendido a quien nadie habia atendido); esta exige que los salientes si
// cierren, para no producir el incumplimiento falso contrario.
//
// El modo de fallo que este archivo vigila es "alguien agrega un canal nuevo y se
// olvida": asi nacieron los tres huecos que arregla la tarjeta. Si agregas un canal
// saliente, agregalo aqui.

const meetSlaTimers = vi.fn();
vi.mock("@/lib/workflows/sla", () => ({
  meetSlaTimers: (...a: unknown[]) => meetSlaTimers(...a),
}));

const msgCreate = vi.fn();
const actCreate = vi.fn();
const actFindUnique = vi.fn();
const convUpdate = vi.fn();
const gmailThreadFindUnique = vi.fn();
const gmailThreadCreate = vi.fn();
const gmailThreadUpdate = vi.fn();
vi.mock("@/lib/db", () => {
  const db = {
    message: { create: (...a: unknown[]) => msgCreate(...a) },
    activity: { create: (...a: unknown[]) => actCreate(...a), findUnique: (...a: unknown[]) => actFindUnique(...a) },
    conversation: { update: (...a: unknown[]) => convUpdate(...a) },
    gmailThread: {
      findUnique: (...a: unknown[]) => gmailThreadFindUnique(...a),
      create: (...a: unknown[]) => gmailThreadCreate(...a),
      update: (...a: unknown[]) => gmailThreadUpdate(...a),
    },
  };
  return { default: db, prisma: db };
});

const deliverMetaTemplate = vi.fn();
vi.mock("@/lib/whatsapp/transport", () => ({
  activeProvider: () => "meta_cloud",
  deliverMetaTemplate: (...a: unknown[]) => deliverMetaTemplate(...a),
  deliverWhatsApp: vi.fn(),
  mediaSupportsCaption: () => true,
}));

const twilioCreate = vi.fn();
vi.mock("@/lib/twilio/client", () => ({
  getTwilioClient: () => ({ messages: { create: (...a: unknown[]) => twilioCreate(...a) } }),
}));

vi.mock("@/lib/google/workspace.service", () => ({ getGmailClient: vi.fn() }));
vi.mock("@/lib/messaging/conversations", () => ({ ensureConversation: vi.fn(async () => ({ id: "conv1" })) }));

import { sendWhatsAppTemplate } from "@/lib/twilio/whatsapp";
import { sendSMS } from "@/lib/twilio/sms";
import { logOutboundSend } from "@/lib/google/gmail";

beforeEach(() => {
  vi.clearAllMocks();
  meetSlaTimers.mockResolvedValue(1);
  msgCreate.mockResolvedValue({ id: "m1" });
  actCreate.mockResolvedValue({ id: "a1" });
  actFindUnique.mockResolvedValue(null); // sin duplicado previo
  convUpdate.mockResolvedValue({ id: "conv1" });
  gmailThreadFindUnique.mockResolvedValue(null);
  gmailThreadCreate.mockResolvedValue({});
  gmailThreadUpdate.mockResolvedValue({});
  deliverMetaTemplate.mockResolvedValue({ externalId: "wamid.T" });
  twilioCreate.mockResolvedValue({ sid: "SM123" });
  process.env.TWILIO_PHONE_NUMBER = "+15550001111";
});

describe("#731 — todo saliente real detiene el reloj de SLA", () => {
  it("plantilla de WhatsApp (fuera de la ventana de 24h)", async () => {
    await sendWhatsAppTemplate("+5219991112233", "recordatorio_cita", ["Ana", "7 AM"], "c1", "u1");
    expect(actCreate).toHaveBeenCalled(); // el toque quedo registrado…
    expect(meetSlaTimers).toHaveBeenCalledWith("c1"); // …y ademas paro el reloj
  });

  it("SMS", async () => {
    await sendSMS("+5219991112233", "Te marco en 10 minutos.", "c1", "u1");
    expect(actCreate).toHaveBeenCalled();
    expect(meetSlaTimers).toHaveBeenCalledWith("c1");
  });

  it("correo saliente de Gmail", async () => {
    const logged = await logOutboundSend({
      userId: "u1",
      contactId: "c1",
      messageId: "gmail-1",
      threadId: "thread-1",
      subject: "Tu cotizacion",
      snippet: "Adjunto la cotizacion…",
    });
    expect(logged).toBe(true);
    expect(actCreate).toHaveBeenCalled();
    expect(meetSlaTimers).toHaveBeenCalledWith("c1");
  });

  it("un correo YA registrado no vuelve a tocar el reloj (dedup)", async () => {
    actFindUnique.mockResolvedValue({ id: "a-previa" });
    const logged = await logOutboundSend({
      userId: "u1",
      contactId: "c1",
      messageId: "gmail-1",
      threadId: "thread-1",
      subject: "Tu cotizacion",
      snippet: "…",
    });
    expect(logged).toBe(false);
    expect(meetSlaTimers).not.toHaveBeenCalled();
  });
});
