// Servicio de SMS via Twilio — envío y recepción
import { prisma } from "@/lib/db";
import { getTwilioClient } from "./client";
import { findContactByPhone, normalizePhone } from "./utils";

/**
 * Envía un SMS a un contacto y registra el mensaje + actividad.
 */
export async function sendSMS(
  to: string,
  body: string,
  contactId: string,
  userId: string
) {
  const client = getTwilioClient();
  const from = process.env.TWILIO_PHONE_NUMBER;

  if (!from) throw new Error("TWILIO_PHONE_NUMBER no configurado");

  const normalized = normalizePhone(to);

  // Enviar via Twilio
  const twilioMsg = await client.messages.create({
    body,
    from,
    to: normalized,
  });

  // Crear registro de mensaje
  const message = await prisma.message.create({
    data: {
      contactId,
      userId,
      channel: "SMS",
      direction: "OUTBOUND",
      body,
      twilioSid: twilioMsg.sid,
      status: "SENT",
      externalPhone: normalized,
    },
  });

  // Crear actividad asociada
  await prisma.activity.create({
    data: {
      contactId,
      userId,
      activityType: "SMS_OUT",
      subject: `SMS enviado`,
      description: body.length > 100 ? body.substring(0, 100) + "..." : body,
      status: "COMPLETADA",
      completedAt: new Date(),
    },
  });

  return message;
}

/**
 * Procesa un SMS entrante desde el webhook de Twilio.
 * Busca el contacto por teléfono y crea el registro.
 */
export async function handleInboundSMS(payload: {
  From: string;
  Body: string;
  MessageSid: string;
  NumMedia?: string;
  MediaUrl0?: string;
}) {
  const contact = await findContactByPhone(payload.From);

  if (!contact) {
    // Registrar como mensaje sin contacto asociado — se puede vincular después
    console.warn(`SMS entrante de número desconocido: ${payload.From}`);
    return null;
  }

  // Crear registro de mensaje
  const message = await prisma.message.create({
    data: {
      contactId: contact.id,
      userId: contact.assignedToId,
      channel: "SMS",
      direction: "INBOUND",
      body: payload.Body,
      twilioSid: payload.MessageSid,
      mediaUrl: payload.MediaUrl0 || null,
      status: "DELIVERED",
      externalPhone: normalizePhone(payload.From),
    },
  });

  // Crear actividad
  await prisma.activity.create({
    data: {
      contactId: contact.id,
      userId: contact.assignedToId || contact.id, // fallback si no hay asesor
      activityType: "SMS_IN",
      subject: `SMS recibido de ${contact.firstName} ${contact.lastName}`,
      description: payload.Body.length > 100
        ? payload.Body.substring(0, 100) + "..."
        : payload.Body,
      status: "COMPLETADA",
      completedAt: new Date(),
    },
  });

  // Notificar al asesor asignado
  if (contact.assignedToId) {
    await prisma.notification.create({
      data: {
        userId: contact.assignedToId,
        title: "SMS recibido",
        message: `${contact.firstName} ${contact.lastName}: ${payload.Body.substring(0, 80)}`,
        type: "sms_inbound",
        link: `/dashboard/contacts/${contact.id}`,
      },
    });
  }

  return message;
}
