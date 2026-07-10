import prisma from "@/lib/db";
import { readCredentials } from "@/lib/intake/connectors";
import type { MessagingChannel } from "./types";
import type { MessageStatus } from "@prisma/client";

const OUT_ACTIVITY: Record<MessagingChannel, "WHATSAPP_OUT" | "INSTAGRAM_OUT" | "MESSENGER_OUT"> = {
  WHATSAPP: "WHATSAPP_OUT",
  INSTAGRAM: "INSTAGRAM_OUT",
  MESSENGER: "MESSENGER_OUT",
};

/** Envío saliente unificado por canal. Devuelve el Message creado. */
export async function sendChannelMessage(
  channel: MessagingChannel,
  contactId: string,
  body: string,
  userId: string,
  opts: { bot?: boolean; connectorId?: string | null } = {}
) {
  if (channel === "WHATSAPP") {
    const c = await prisma.contact.findUnique({ where: { id: contactId }, select: { phone: true } });
    if (!c?.phone) throw new Error("Contacto sin teléfono");
    const { sendWhatsAppMessage } = await import("@/lib/twilio/whatsapp");
    const message = await sendWhatsAppMessage(c.phone, body, contactId, userId, opts.connectorId ?? null);
    if (opts.bot) {
      return prisma.message.update({
        where: { id: message.id },
        data: { sender: "BOT", aiGenerated: true, aiAutonomy: "L2" },
      });
    }
    return message;
  }

  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { instagramId: true, messengerPsid: true },
  });
  const recipientId = channel === "INSTAGRAM" ? contact?.instagramId : contact?.messengerPsid;
  if (!recipientId) throw new Error(`Contacto sin id ${channel}`);

  if (!opts.connectorId) throw new Error(`Falta connectorId para enviar ${channel} (conversación sin cuenta resuelta)`);
  const connector = await prisma.leadConnector.findUnique({ where: { id: opts.connectorId } });
  if (!connector || connector.status !== "ACTIVE") throw new Error(`Conector ${channel} inválido o inactivo`);
  const creds = readCredentials<{ pageAccessToken: string }>(connector);
  if (!creds?.pageAccessToken) throw new Error(`Conector ${channel} sin pageAccessToken`);

  const send = channel === "INSTAGRAM"
    ? (await import("./adapters/instagram")).sendInstagram
    : (await import("./adapters/messenger")).sendMessenger;
  const result = await send(creds.pageAccessToken, recipientId, body);

  const { ensureConversation } = await import("./conversations");
  const conv0 = await ensureConversation({ contactId, channel, connectorId: connector.id });
  const conversation = await prisma.conversation.update({ where: { id: conv0.id }, data: { lastMessageAt: new Date() } });

  const message = await prisma.message.create({
    data: {
      contactId,
      userId,
      channel,
      direction: "OUTBOUND",
      body,
      externalMessageId: result.externalMessageId,
      status: result.status as MessageStatus,
      conversationId: conversation.id,
      sender: opts.bot ? "BOT" : "ADVISOR",
      aiGenerated: opts.bot ?? false,
      aiAutonomy: opts.bot ? "L2" : null,
    },
  });

  await prisma.activity.create({
    data: {
      contactId,
      userId,
      activityType: OUT_ACTIVITY[channel],
      subject: `Mensaje ${channel} enviado`,
      description: body.length > 100 ? body.slice(0, 100) + "..." : body,
      status: "COMPLETADA",
      completedAt: new Date(),
    },
  });

  const { meetSlaTimers } = await import("@/lib/workflows/sla");
  await meetSlaTimers(contactId);

  return message;
}
