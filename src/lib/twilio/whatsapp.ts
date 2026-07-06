// Servicio de WhatsApp via Twilio — envío, templates y recepción
import { prisma } from "@/lib/db";
import { getTwilioClient } from "./client";
import { findContactByPhone, normalizePhone } from "./utils";

/**
 * Envía un mensaje de WhatsApp a un contacto.
 */
export async function sendWhatsAppMessage(
  to: string,
  body: string,
  contactId: string,
  userId: string,
  connectorId?: string | null
) {
  const normalized = normalizePhone(to);

  // Transporte intercambiable (Meta Cloud API default / Twilio alterno) — 2026-06-11
  const { deliverWhatsApp } = await import("@/lib/whatsapp/transport");
  const delivery = await deliverWhatsApp(normalized, body);

  // Hilo de conversación (Anexo B §I) — el saliente también vive en el hilo
  const { ensureConversation } = await import("@/lib/messaging/conversations");
  const conv0 = await ensureConversation({ contactId, channel: "WHATSAPP", connectorId: connectorId ?? null });
  const conversation = await prisma.conversation.update({ where: { id: conv0.id }, data: { lastMessageAt: new Date() } });

  const message = await prisma.message.create({
    data: {
      contactId,
      userId,
      channel: "WHATSAPP",
      direction: "OUTBOUND",
      body,
      twilioSid: delivery.externalId, // wamid (Meta) o SID (Twilio)
      status: delivery.status,
      externalPhone: normalized,
      conversationId: conversation.id,
      sender: "ADVISOR",
    },
  });

  await prisma.activity.create({
    data: {
      contactId,
      userId,
      activityType: "WHATSAPP_OUT",
      subject: `WhatsApp enviado`,
      description: body.length > 100 ? body.substring(0, 100) + "..." : body,
      status: "COMPLETADA",
      completedAt: new Date(),
    },
  });

  // Toque saliente real → cumple SLA de primer contacto (P2)
  const { meetSlaTimers } = await import("@/lib/workflows/sla");
  await meetSlaTimers(contactId);

  return message;
}

/**
 * Envía un template de WhatsApp Business API.
 */
export async function sendWhatsAppTemplate(
  to: string,
  templateName: string,
  templateParams: string[],
  contactId: string,
  userId: string,
  language: string = "es_MX"
) {
  const normalized = normalizePhone(to);

  // Plantilla aprobada — necesaria fuera de la ventana de 24h (business-initiated)
  const { activeProvider, deliverMetaTemplate } = await import("@/lib/whatsapp/transport");
  let externalId: string;
  if (activeProvider() === "meta_cloud") {
    const delivery = await deliverMetaTemplate(normalized, templateName, language, templateParams);
    externalId = delivery.externalId;
  } else {
    const client = getTwilioClient();
    const from = process.env.TWILIO_WHATSAPP_NUMBER;
    if (!from) throw new Error("TWILIO_WHATSAPP_NUMBER no configurado");
    const twilioMsg = await client.messages.create({
      from: `whatsapp:${from}`,
      to: `whatsapp:${normalized}`,
      body: templateParams.join(" | "), // Fallback si no se usa contentSid
    });
    externalId = twilioMsg.sid;
  }

  const message = await prisma.message.create({
    data: {
      contactId,
      userId,
      channel: "WHATSAPP",
      direction: "OUTBOUND",
      body: `[Template: ${templateName}] ${templateParams.join(", ")}`,
      twilioSid: externalId,
      templateName,
      status: "SENT",
      externalPhone: normalized,
    },
  });

  await prisma.activity.create({
    data: {
      contactId,
      userId,
      activityType: "WHATSAPP_OUT",
      subject: `Template WhatsApp: ${templateName}`,
      status: "COMPLETADA",
      completedAt: new Date(),
    },
  });

  return message;
}

/**
 * Procesa un WhatsApp entrante desde el webhook de Twilio.
 * Delega el intake agnóstico en handleInboundMessage (core). Solo retiene
 * lo específico de WhatsApp: opt-out por keyword antes de continuar el flujo.
 */
export async function handleInboundWhatsApp(payload: {
  From: string;
  Body: string;
  MessageSid: string;
  NumMedia?: string;
  MediaUrl0?: string;
  ProfileName?: string;
}) {
  const rawPhone = payload.From.replace("whatsapp:", "");

  // Opt-out por keyword (§I.3 paso 7) — específico de WhatsApp.
  // Si aplica, marca el contacto y NO continúa el flujo normal.
  const optOutWords = ["BAJA", "STOP", "ALTO", "UNSUBSCRIBE"];
  if (optOutWords.includes(payload.Body.trim().toUpperCase())) {
    const contact = await findContactByPhone(rawPhone);
    if (contact) {
      await prisma.contact.update({
        where: { id: contact.id },
        data: { whatsappOptOut: true },
      });
      const { emitEvent } = await import("@/lib/workflows/events");
      await emitEvent("contact.opted_out", "contact", contact.id, { channel: "WHATSAPP" });
    }
    return null;
  }

  // Delegar intake completo al core agnóstico (§I.3 pasos 2-6)
  const { handleInboundMessage } = await import("@/lib/messaging/core");
  return handleInboundMessage({
    channel: "WHATSAPP",
    senderId: normalizePhone(rawPhone),
    externalMessageId: payload.MessageSid,
    text: payload.Body,
    mediaUrl: payload.MediaUrl0 || null,
    profileName: payload.ProfileName ?? null,
  });
}
