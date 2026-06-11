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
  userId: string
) {
  const client = getTwilioClient();
  const from = process.env.TWILIO_WHATSAPP_NUMBER;

  if (!from) throw new Error("TWILIO_WHATSAPP_NUMBER no configurado");

  const normalized = normalizePhone(to);

  const twilioMsg = await client.messages.create({
    body,
    from: `whatsapp:${from}`,
    to: `whatsapp:${normalized}`,
  });

  // Hilo de conversación (Anexo B §I) — el saliente también vive en el hilo
  const conversation = await prisma.conversation.upsert({
    where: { contactId_channel: { contactId, channel: "WHATSAPP" } },
    update: { lastMessageAt: new Date() },
    create: { contactId, channel: "WHATSAPP", status: "BOT", lastMessageAt: new Date() },
  });

  const message = await prisma.message.create({
    data: {
      contactId,
      userId,
      channel: "WHATSAPP",
      direction: "OUTBOUND",
      body,
      twilioSid: twilioMsg.sid,
      status: "SENT",
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
  userId: string
) {
  const client = getTwilioClient();
  const from = process.env.TWILIO_WHATSAPP_NUMBER;

  if (!from) throw new Error("TWILIO_WHATSAPP_NUMBER no configurado");

  const normalized = normalizePhone(to);

  // Twilio Content API para templates
  const twilioMsg = await client.messages.create({
    from: `whatsapp:${from}`,
    to: `whatsapp:${normalized}`,
    body: templateParams.join(" | "), // Fallback si no se usa contentSid
  });

  const message = await prisma.message.create({
    data: {
      contactId,
      userId,
      channel: "WHATSAPP",
      direction: "OUTBOUND",
      body: `[Template: ${templateName}] ${templateParams.join(", ")}`,
      twilioSid: twilioMsg.sid,
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
 */
export async function handleInboundWhatsApp(payload: {
  From: string;
  Body: string;
  MessageSid: string;
  NumMedia?: string;
  MediaUrl0?: string;
  ProfileName?: string;
}) {
  // Quitar prefijo "whatsapp:" del From
  const rawPhone = payload.From.replace("whatsapp:", "");
  let contact = await findContactByPhone(rawPhone);

  // Número desconocido → captura como lead WHATSAPP (Anexo B §I.3 paso 2)
  if (!contact) {
    const { captureLead } = await import("@/lib/intake/capture-lead");
    const result = await captureLead({
      source: "WHATSAPP",
      firstName: payload.ProfileName?.trim() || "WhatsApp",
      lastName: "(por identificar)",
      phone: rawPhone,
      message: payload.Body,
    });
    if (!result.contactId) {
      console.warn(`WhatsApp entrante no capturable: ${rawPhone}`);
      return null;
    }
    contact = await prisma.contact.findUnique({
      where: { id: result.contactId },
      include: { assignedTo: { select: { id: true, name: true } } },
    });
    if (!contact) return null;
  }

  // Conversación del hilo (un hilo por contacto+canal — §I.1)
  const conversation = await prisma.conversation.upsert({
    where: { contactId_channel: { contactId: contact.id, channel: "WHATSAPP" } },
    update: { lastMessageAt: new Date(), lastInboundAt: new Date(), unreadCount: { increment: 1 } },
    create: {
      contactId: contact.id,
      channel: "WHATSAPP",
      status: "BOT",
      lastMessageAt: new Date(),
      lastInboundAt: new Date(),
      unreadCount: 1,
    },
  });

  const message = await prisma.message.create({
    data: {
      contactId: contact.id,
      userId: contact.assignedToId,
      channel: "WHATSAPP",
      direction: "INBOUND",
      body: payload.Body,
      twilioSid: payload.MessageSid,
      mediaUrl: payload.MediaUrl0 || null,
      status: "DELIVERED",
      externalPhone: normalizePhone(rawPhone),
      conversationId: conversation.id,
      sender: "CONTACT",
    },
  });

  await prisma.activity.create({
    data: {
      contactId: contact.id,
      userId: contact.assignedToId || contact.id,
      activityType: "WHATSAPP_IN",
      subject: `WhatsApp recibido de ${contact.firstName} ${contact.lastName}`,
      description: payload.Body.length > 100
        ? payload.Body.substring(0, 100) + "..."
        : payload.Body,
      status: "COMPLETADA",
      completedAt: new Date(),
    },
  });

  // Opt-out por palabra clave (§I.3 paso 7) — confirmación única y silencio
  const optOutWords = ["BAJA", "STOP", "ALTO", "UNSUBSCRIBE"];
  if (optOutWords.includes(payload.Body.trim().toUpperCase())) {
    await prisma.contact.update({
      where: { id: contact.id },
      data: { whatsappOptOut: true },
    });
    const { emitEvent } = await import("@/lib/workflows/events");
    await emitEvent("contact.opted_out", "contact", contact.id, { channel: "WHATSAPP" });
    return message;
  }

  // El contacto respondió → SLA cumplido + evento (§I.3 paso 5)
  const { meetSlaTimers } = await import("@/lib/workflows/sla");
  const { emitEvent } = await import("@/lib/workflows/events");
  await meetSlaTimers(contact.id);
  await emitEvent("whatsapp.replied", "conversation", conversation.id, {
    contactId: contact.id,
    body: payload.Body.slice(0, 500),
  });

  if (conversation.status === "HUMAN") {
    // Hilo controlado por humano: notificar, NO responder automático (§I.3 paso 6)
    if (conversation.controlledById || contact.assignedToId) {
      await prisma.notification.create({
        data: {
          userId: conversation.controlledById ?? contact.assignedToId!,
          title: "WhatsApp recibido (controlas el hilo)",
          message: `${contact.firstName} ${contact.lastName}: ${payload.Body.substring(0, 80)}`,
          type: "whatsapp_inbound",
          link: `/inbox?c=${conversation.id}`,
        },
      });
    }
  } else if (conversation.status === "BOT" && conversation.botEnabled && !contact.whatsappOptOut) {
    // Bot responde (L2 con red) — best-effort, nunca rompe el webhook de Twilio
    try {
      const { botRespond } = await import("@/lib/bot/bot-respond");
      await botRespond(contact.id, {});
    } catch (err) {
      console.error("[whatsapp] botRespond falló:", err);
    }
    if (contact.assignedToId) {
      await prisma.notification.create({
        data: {
          userId: contact.assignedToId,
          title: "WhatsApp recibido (bot activo)",
          message: `${contact.firstName} ${contact.lastName}: ${payload.Body.substring(0, 80)}`,
          type: "whatsapp_inbound",
          link: `/inbox?c=${conversation.id}`,
        },
      });
    }
  }

  return message;
}
