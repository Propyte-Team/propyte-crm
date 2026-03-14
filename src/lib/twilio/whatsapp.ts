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
}) {
  // Quitar prefijo "whatsapp:" del From
  const rawPhone = payload.From.replace("whatsapp:", "");
  const contact = await findContactByPhone(rawPhone);

  if (!contact) {
    console.warn(`WhatsApp entrante de número desconocido: ${rawPhone}`);
    return null;
  }

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

  if (contact.assignedToId) {
    await prisma.notification.create({
      data: {
        userId: contact.assignedToId,
        title: "WhatsApp recibido",
        message: `${contact.firstName} ${contact.lastName}: ${payload.Body.substring(0, 80)}`,
        type: "whatsapp_inbound",
        link: `/dashboard/contacts/${contact.id}`,
      },
    });
  }

  return message;
}
